#include "FrameReceiver.h"

#include <algorithm>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

using neural::FrameReceiver;
using neural::IngestResult;
using Bytes = std::vector<std::uint8_t>;

#define CHECK(condition) do { if (!(condition)) { \
  std::cerr << __FILE__ << ':' << __LINE__ << ": " #condition "\n"; std::exit(1); \
} } while (false)

static Bytes rgb(std::size_t leds, unsigned seed = 23) {
  Bytes result(leds * 3);
  for (std::size_t i = 0; i < result.size(); ++i) result[i] = static_cast<std::uint8_t>(i * 17 + seed);
  return result;
}

static Bytes packet(const Bytes& frame, std::uint8_t sequence, std::size_t offset = 0,
                    std::size_t length = 0, bool push = true) {
  if (length == 0) length = frame.size() - offset;
  Bytes result{static_cast<std::uint8_t>(push ? 0x41 : 0x40), sequence, 1, 1,
               static_cast<std::uint8_t>(offset >> 24), static_cast<std::uint8_t>(offset >> 16),
               static_cast<std::uint8_t>(offset >> 8), static_cast<std::uint8_t>(offset),
               static_cast<std::uint8_t>(length >> 8), static_cast<std::uint8_t>(length)};
  result.insert(result.end(), frame.begin() + offset, frame.begin() + offset + length);
  return result;
}

static IngestResult feed(FrameReceiver& receiver, const Bytes& bytes, std::uint32_t now) {
  return receiver.ingest(bytes.data(), bytes.size(), now);
}

static void equalFrame(const FrameReceiver& receiver, const Bytes& expected) {
  CHECK(receiver.byteCount() == expected.size());
  CHECK(std::equal(expected.begin(), expected.end(), receiver.data()));
}

static void initialAndConfiguration() {
  FrameReceiver receiver;
  CHECK(receiver.ledCount() == 240);
  CHECK(!receiver.ready());
  CHECK(!receiver.expire(4000));
  equalFrame(receiver, Bytes(720, 0));
  CHECK(receiver.configure(1));
  const auto frame = rgb(1);
  CHECK(feed(receiver, packet(frame, 1), 4001) == IngestResult::FrameReady);
  CHECK(!receiver.configure(0));
  CHECK(!receiver.configure(1025));
  CHECK(receiver.ready());
  equalFrame(receiver, frame);
  CHECK(receiver.configure(1024));
  CHECK(!receiver.ready());
  CHECK(receiver.stats().frames == 1);  // Lifetime counters survive configure.
  equalFrame(receiver, Bytes(3072, 0));
}

static void completeAndLatestWins() {
  FrameReceiver receiver(240);
  const auto first = rgb(240);
  const auto second = rgb(240, 99);
  CHECK(feed(receiver, packet(first, 1), 10) == IngestResult::FrameReady);
  CHECK(receiver.ready());
  equalFrame(receiver, first);
  CHECK(feed(receiver, packet(second, 2), 27) == IngestResult::FrameReady);
  equalFrame(receiver, second);
  CHECK(receiver.stats().frames == 2);
  CHECK(receiver.stats().supersededFrames == 1);
  receiver.consume();
  CHECK(!receiver.ready());
  equalFrame(receiver, second);
}

static void fragmentedOutOfOrder() {
  FrameReceiver receiver(1000);
  const auto frame = rgb(1000);
  const auto first = packet(frame, 1, 0, 1440, false);
  const auto middle = packet(frame, 1, 1440, 1440, false);
  const auto last = packet(frame, 1, 2880, 120, true);
  CHECK(feed(receiver, last, 0) == IngestResult::Buffered);  // PUSH can arrive first.
  CHECK(!receiver.ready());
  CHECK(feed(receiver, first, 1) == IngestResult::Buffered);
  CHECK(feed(receiver, first, 2) == IngestResult::Buffered);  // Identical duplicate.
  CHECK(!receiver.ready());
  CHECK(feed(receiver, middle, 3) == IngestResult::FrameReady);
  equalFrame(receiver, frame);
  CHECK(receiver.stats().frames == 1);
  CHECK(receiver.stats().packets == 4);
  CHECK(feed(receiver, last, 4) == IngestResult::Rejected);  // No duplicate commit.
  CHECK(receiver.stats().stalePackets == 1);
}

static void missingFragmentAndReplacement() {
  FrameReceiver receiver(1000);
  const auto old = rgb(1000);
  const auto next = rgb(1000, 52);
  CHECK(feed(receiver, packet(old, 1, 0, 1440, false), 10) == IngestResult::Buffered);
  CHECK(feed(receiver, packet(old, 1, 2880, 120, true), 11) == IngestResult::Buffered);
  CHECK(!receiver.ready());
  equalFrame(receiver, Bytes(3000, 0));
  CHECK(feed(receiver, packet(next, 2, 0, 1440, false), 27) == IngestResult::Buffered);
  CHECK(receiver.stats().abandonedFrames == 1);
  CHECK(feed(receiver, packet(old, 1, 1440, 1440, false), 28) == IngestResult::Rejected);
  CHECK(feed(receiver, packet(next, 2, 1440, 1440, false), 29) == IngestResult::Buffered);
  CHECK(feed(receiver, packet(next, 2, 2880, 120, true), 30) == IngestResult::FrameReady);
  equalFrame(receiver, next);
}

static void missingPushAndPartialTimeout() {
  FrameReceiver receiver(2);
  const auto frame = rgb(2);
  CHECK(feed(receiver, packet(frame, 1, 0, 6, false), 10) == IngestResult::Buffered);
  CHECK(!receiver.ready());  // Complete coverage without PUSH still isn't a frame.
  CHECK(!receiver.expire(110));
  CHECK(receiver.stats().abandonedFrames == 1);
  CHECK(!receiver.ready());
  CHECK(feed(receiver, packet(frame, 9), 111) == IngestResult::FrameReady); // Resync.
  equalFrame(receiver, frame);
}

static void conflictingDuplicateDropsAssembly() {
  FrameReceiver receiver(3);
  const auto frame = rgb(3);
  auto conflicting = packet(frame, 1, 0, 3, false);
  CHECK(feed(receiver, conflicting, 10) == IngestResult::Buffered);
  conflicting[10] ^= 1;
  CHECK(feed(receiver, conflicting, 11) == IngestResult::Rejected);
  CHECK(receiver.stats().malformed == 1);
  CHECK(receiver.stats().abandonedFrames == 1);
  CHECK(feed(receiver, packet(frame, 1, 3, 6, true), 12) == IngestResult::Rejected);
  CHECK(!receiver.ready());
  CHECK(feed(receiver, packet(frame, 2), 27) == IngestResult::FrameReady);
  equalFrame(receiver, frame);
}

static void sequenceWrapAndLowRateResync() {
  FrameReceiver receiver(2);
  auto frame = rgb(2);
  CHECK(feed(receiver, packet(frame, 14), 0) == IngestResult::FrameReady);
  CHECK(feed(receiver, packet(frame, 15), 16) == IngestResult::FrameReady);
  CHECK(feed(receiver, packet(frame, 1), 33) == IngestResult::FrameReady);
  CHECK(feed(receiver, packet(frame, 15), 34) == IngestResult::Rejected);
  CHECK(feed(receiver, packet(frame, 8), 50) == IngestResult::FrameReady); // Skip 7.
  CHECK(feed(receiver, packet(frame, 1), 51) == IngestResult::Rejected); // Ambiguous 8.
  CHECK(feed(receiver, packet(frame, 1), 150) == IngestResult::FrameReady); // 100ms resync.
  CHECK(feed(receiver, packet(frame, 1), 1150) == IngestResult::FrameReady); // 1 FPS repeat.
}

static void malformedNeverChangesOutput() {
  FrameReceiver receiver(2);
  const auto frame = rgb(2);
  const auto good = packet(frame, 1);
  CHECK(feed(receiver, good, 10) == IngestResult::FrameReady);
  receiver.consume();
  std::vector<Bytes> bad;
  for (std::uint8_t flags : {0x00, 0x01, 0x42, 0x45, 0x49, 0x51, 0x81}) {
    auto b = good; b[0] = flags; bad.push_back(b);
  }
  for (std::uint8_t sequence : {0, 16, 255}) {
    auto b = good; b[1] = sequence; bad.push_back(b);
  }
  { auto b = good; b[2] = 2; bad.push_back(b); }
  { auto b = good; b[3] = 2; bad.push_back(b); }
  { auto b = good; b[7] = 1; bad.push_back(b); } // RGB misalignment.
  { auto b = good; b[7] = 6; bad.push_back(b); } // Entirely out of range.
  { auto b = good; b[7] = 3; bad.push_back(b); } // Overrun configured frame.
  { auto b = good; b[4] = b[5] = b[6] = b[7] = 255; bad.push_back(b); }
  { auto b = good; b[8] = b[9] = 255; bad.push_back(b); }
  { auto b = good; b[8] = b[9] = 0; bad.push_back(b); }
  { auto b = good; b[9] = 5; b.pop_back(); bad.push_back(b); } // Partial RGB.
  { auto b = good; b.pop_back(); bad.push_back(b); }
  { auto b = good; b.push_back(0); bad.push_back(b); }
  bad.push_back(packet(frame, 2, 0, 3, true)); // PUSH before configured frame end.
  bad.push_back(Bytes(FrameReceiver::kMaxPacketBytes + 1, 0));
  for (std::size_t length = 0; length < 10; ++length) bad.push_back(Bytes(length, 0));
  for (const auto& bytes : bad) {
    CHECK(feed(receiver, bytes, 20) == IngestResult::Rejected);
    equalFrame(receiver, frame);
    CHECK(!receiver.ready());
  }
  CHECK(receiver.ingest(nullptr, 16, 20) == IngestResult::Rejected);
  CHECK(receiver.stats().frames == 1);
  CHECK(receiver.stats().malformed == bad.size() + 1);
}

static void malformedCannotKeepStreamAlive() {
  FrameReceiver receiver(2);
  const auto frame = rgb(2);
  CHECK(feed(receiver, packet(frame, 1), 100) == IngestResult::FrameReady);
  receiver.consume();
  CHECK(!receiver.expire(2099));
  CHECK(feed(receiver, packet(frame, 2, 0, 3, false), 2099) == IngestResult::Buffered);
  CHECK(receiver.expire(2100));
  CHECK(receiver.ready());
  equalFrame(receiver, Bytes(6, 0));
  CHECK(receiver.stats().frames == 1);
  CHECK(receiver.stats().blackouts == 1);
  receiver.consume();
  CHECK(!receiver.expire(5000));
  CHECK(!receiver.ready());
  CHECK(feed(receiver, packet(frame, 10), 5010) == IngestResult::FrameReady);
  equalFrame(receiver, frame);
}

static void timerWrap() {
  FrameReceiver receiver(2);
  const auto frame = rgb(2);
  const auto start = UINT32_MAX - 999U;
  CHECK(feed(receiver, packet(frame, 15), start) == IngestResult::FrameReady);
  receiver.consume();
  CHECK(!receiver.expire(999)); // 1999 ms elapsed across the counter wrap.
  CHECK(receiver.expire(1000));
  equalFrame(receiver, Bytes(6, 0));
  CHECK(feed(receiver, packet(frame, 1), 1016) == IngestResult::FrameReady);
}

static void zeroBrightnessIsAnOrdinaryImmediateFrame() {
  FrameReceiver receiver(240);
  CHECK(feed(receiver, packet(rgb(240), 1), 0) == IngestResult::FrameReady);
  CHECK(feed(receiver, packet(Bytes(720, 0), 2), 1) == IngestResult::FrameReady);
  equalFrame(receiver, Bytes(720, 0));
  CHECK(receiver.ready());
  CHECK(receiver.stats().blackouts == 0); // It came from the app, not timeout.
}

static void maxLedsAndBoundedFuzz() {
  FrameReceiver receiver(1024);
  const auto frame = rgb(1024);
  CHECK(feed(receiver, packet(frame, 1, 0, 1440, false), 0) == IngestResult::Buffered);
  CHECK(feed(receiver, packet(frame, 1, 1440, 1440, false), 1) == IngestResult::Buffered);
  CHECK(feed(receiver, packet(frame, 1, 2880, 192, true), 2) == IngestResult::FrameReady);
  equalFrame(receiver, frame);
  receiver.consume();
  std::uint32_t random = 0x12345678;
  auto next = [&random]() { random ^= random << 13; random ^= random >> 17; random ^= random << 5; return random; };
  // Deterministic hostile lengths/headers exercise sanitizers without device IO.
  for (unsigned n = 0; n < 20000; ++n) {
    Bytes bytes(next() % 1500);
    for (auto& byte : bytes) byte = static_cast<std::uint8_t>(next());
    feed(receiver, bytes, 3);
  }
  equalFrame(receiver, frame);
  CHECK(!receiver.ready());
}

static void actualMacGoldenFixture(const char* path) {
  std::ifstream file(path);
  CHECK(file.good());
  FrameReceiver receiver(1000);
  std::string line;
  unsigned fragments = 0;
  while (std::getline(file, line)) {
    if (line.empty() || line[0] == '#') continue;
    CHECK(line.size() % 2 == 0);
    Bytes bytes;
    for (std::size_t i = 0; i < line.size(); i += 2) {
      bytes.push_back(static_cast<std::uint8_t>(std::stoul(line.substr(i, 2), nullptr, 16)));
    }
    ++fragments;
    const auto result = feed(receiver, bytes, fragments);
    CHECK(result == (fragments == 3 ? IngestResult::FrameReady : IngestResult::Buffered));
  }
  CHECK(fragments == 3);
  equalFrame(receiver, rgb(1000));
}

int main(int argc, char** argv) {
  CHECK(argc == 2);
  initialAndConfiguration();
  completeAndLatestWins();
  fragmentedOutOfOrder();
  missingFragmentAndReplacement();
  missingPushAndPartialTimeout();
  conflictingDuplicateDropsAssembly();
  sequenceWrapAndLowRateResync();
  malformedNeverChangesOutput();
  malformedCannotKeepStreamAlive();
  timerWrap();
  zeroBrightnessIsAnOrdinaryImmediateFrame();
  maxLedsAndBoundedFuzz();
  actualMacGoldenFixture(argv[1]);
  std::cout << "13 receiver checks passed (including 20,000 malformed packets and Mac DDP fixture).\n";
}
