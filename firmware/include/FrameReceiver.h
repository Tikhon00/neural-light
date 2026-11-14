#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace neural {

// This receiver implements NEURAL LIGHT's DDP v1 RGB profile, not every DDP
// sender: type=1, display=1, byte offsets, 1..15 sequence shared by all fragments
// of one frame, and PUSH on the final fragment. Sequence 0, timestamped packets,
// partial-strip updates and senders incrementing sequence per packet are rejected.
// The Mac sender is native/Sources/NeuralCore/Packets.swift. Keep them in sync.
// Four sequence bits cannot identify arbitrarily delayed/replayed UDP traffic.
// Ordering protects the short receive window; 100 ms without a new accepted
// sequence resynchronizes it. This is a trusted-LAN protocol, not authentication.
enum class IngestResult { Rejected, Buffered, FrameReady };

struct ReceiverStats {
  std::uint32_t packets = 0;
  std::uint32_t frames = 0;
  std::uint32_t malformed = 0;
  std::uint32_t stalePackets = 0;
  std::uint32_t abandonedFrames = 0;
  std::uint32_t supersededFrames = 0;
  std::uint32_t blackouts = 0;
};

// Single-threaded. Keep this object alive (normally static/global on ESP32).
// All storage is bounded and owned; ingest/expire allocate no heap memory.
class FrameReceiver {
 public:
  static constexpr std::size_t kMaxLeds = 1024;
  static constexpr std::size_t kHeaderBytes = 10;
  static constexpr std::size_t kMaxPayloadBytes = 1440;
  static constexpr std::size_t kMaxPacketBytes = kHeaderBytes + kMaxPayloadBytes;
  static constexpr std::uint32_t kAssemblyTimeoutMs = 100;
  static constexpr std::uint32_t kSequenceResyncMs = 100;

  explicit FrameReceiver(std::uint16_t ledCount = 240) {
    if (ledCount >= 1 && ledCount <= kMaxLeds) ledCount_ = ledCount;
    reset();
  }

  // Invalid configuration leaves the previous configuration/frame untouched.
  // Valid configuration clears output/assembly; the caller blanks its LED driver.
  bool configure(std::uint16_t ledCount) {
    if (ledCount == 0 || ledCount > kMaxLeds) return false;
    ledCount_ = ledCount;
    reset();
    return true;
  }

  std::uint16_t ledCount() const { return ledCount_; }
  std::size_t byteCount() const { return static_cast<std::size_t>(ledCount_) * 3; }
  bool ready() const { return ready_; }
  const std::uint8_t* data() const { return frame_.data(); }
  void consume() { ready_ = false; }
  const ReceiverStats& stats() const { return stats_; }

  // Reset transport/output state but preserve lifetime diagnostic counters.
  void reset() {
    assembly_.fill(0);
    frame_.fill(0);
    coverage_.fill(0);
    coveredLeds_ = 0;
    sequence_ = 0;
    hasSequence_ = assembling_ = pushSeen_ = ready_ = liveFrame_ = false;
    assemblyStartedMs_ = lastSequenceMs_ = lastFrameMs_ = 0;
  }

  IngestResult ingest(const std::uint8_t* packet, std::size_t length,
                      std::uint32_t nowMs) {
    if (packet == nullptr || length < kHeaderBytes || length > kMaxPacketBytes) {
      return malformed();
    }
    // Accept only the two supported flags bytes, including DDP version 1.
    if ((packet[0] != 0x40 && packet[0] != 0x41) || packet[1] == 0 ||
        packet[1] > 15 || packet[2] != 1 || packet[3] != 1) {
      return malformed();
    }
    const std::uint32_t offset = (static_cast<std::uint32_t>(packet[4]) << 24) |
                                 (static_cast<std::uint32_t>(packet[5]) << 16) |
                                 (static_cast<std::uint32_t>(packet[6]) << 8) |
                                 static_cast<std::uint32_t>(packet[7]);
    const std::size_t payload = (static_cast<std::size_t>(packet[8]) << 8) | packet[9];
    const bool push = (packet[0] & 1) != 0;
    const std::size_t total = byteCount();
    // Subtract after checking offset; offset+payload could otherwise overflow.
    if (payload == 0 || payload > kMaxPayloadBytes || payload % 3 != 0 ||
        length != kHeaderBytes + payload || offset % 3 != 0 || offset >= total ||
        payload > total - offset || (push && payload != total - offset)) {
      return malformed();
    }

    expireAssembly(nowMs);
    if (hasSequence_ && elapsed(nowMs, lastSequenceMs_) >= kSequenceResyncMs) {
      abandonAssembly();
      hasSequence_ = false;
    }
    const std::uint8_t incoming = packet[1];
    if (!hasSequence_) {
      beginFrame(incoming, nowMs);
    } else if (incoming != sequence_) {
      const unsigned distance = (static_cast<unsigned>(incoming) + 15 - sequence_) % 15;
      if (distance > 7) return stale();
      abandonAssembly();
      beginFrame(incoming, nowMs);
    } else if (!assembling_) {
      // Includes duplicate fragments of an already committed/discarded frame.
      return stale();
    }

    const std::size_t firstLed = offset / 3;
    const std::size_t payloadLeds = payload / 3;
    // Validate overlaps before writing anything. A conflicting duplicate means
    // this sequence is ambiguous, so discard the partial frame, never display it.
    for (std::size_t i = 0; i < payloadLeds; ++i) {
      const std::size_t led = firstLed + i;
      if (covered(led) &&
          std::memcmp(assembly_.data() + led * 3, packet + kHeaderBytes + i * 3, 3) != 0) {
        abandonAssembly();
        return malformed();
      }
    }
    std::memcpy(assembly_.data() + offset, packet + kHeaderBytes, payload);
    for (std::size_t i = 0; i < payloadLeds; ++i) {
      const std::size_t led = firstLed + i;
      if (!covered(led)) {
        coverage_[led / 8] |= static_cast<std::uint8_t>(1U << (led % 8));
        ++coveredLeds_;
      }
    }
    ++stats_.packets;
    pushSeen_ = pushSeen_ || push;
    if (coveredLeds_ != ledCount_ || !pushSeen_) return IngestResult::Buffered;

    if (ready_) ++stats_.supersededFrames;
    std::memcpy(frame_.data(), assembly_.data(), total);
    ready_ = liveFrame_ = true;
    assembling_ = false;
    lastFrameMs_ = nowMs;
    ++stats_.frames;
    return IngestResult::FrameReady;
  }

  // Call every main-loop iteration, including when no UDP packet arrives.
  // Blackout depends on COMPLETE frames, so malformed/partial packet floods
  // cannot keep stale light on. Blackout is queued once, not counted as a frame.
  // Unsigned subtraction keeps these short intervals safe across millis() wrap.
  bool expire(std::uint32_t nowMs, std::uint32_t timeoutMs = 2000) {
    expireAssembly(nowMs);
    if (!liveFrame_ || elapsed(nowMs, lastFrameMs_) < timeoutMs) return false;
    frame_.fill(0);
    ready_ = true;
    liveFrame_ = false;
    abandonAssembly();
    hasSequence_ = false;
    ++stats_.blackouts;
    return true;
  }

 private:
  static std::uint32_t elapsed(std::uint32_t now, std::uint32_t then) { return now - then; }
  bool covered(std::size_t led) const {
    return (coverage_[led / 8] & static_cast<std::uint8_t>(1U << (led % 8))) != 0;
  }
  void beginFrame(std::uint8_t sequence, std::uint32_t nowMs) {
    coverage_.fill(0);
    coveredLeds_ = 0;
    sequence_ = sequence;
    hasSequence_ = assembling_ = true;
    pushSeen_ = false;
    assemblyStartedMs_ = lastSequenceMs_ = nowMs;
  }
  void abandonAssembly() {
    if (assembling_) ++stats_.abandonedFrames;
    assembling_ = false;
  }
  void expireAssembly(std::uint32_t nowMs) {
    if (assembling_ && elapsed(nowMs, assemblyStartedMs_) >= kAssemblyTimeoutMs) abandonAssembly();
  }
  IngestResult malformed() {
    ++stats_.malformed;
    return IngestResult::Rejected;
  }
  IngestResult stale() {
    ++stats_.stalePackets;
    return IngestResult::Rejected;
  }

  std::uint16_t ledCount_ = 240;
  std::uint16_t coveredLeds_ = 0;
  std::uint8_t sequence_ = 0;
  bool hasSequence_ = false;
  bool assembling_ = false;
  bool pushSeen_ = false;
  bool ready_ = false;
  bool liveFrame_ = false;
  std::uint32_t assemblyStartedMs_ = 0;
  std::uint32_t lastSequenceMs_ = 0;
  std::uint32_t lastFrameMs_ = 0;
  ReceiverStats stats_;
  std::array<std::uint8_t, kMaxLeds * 3> assembly_{};
  std::array<std::uint8_t, kMaxLeds * 3> frame_{};
  std::array<std::uint8_t, (kMaxLeds + 7) / 8> coverage_{};
};

}  // namespace neural
