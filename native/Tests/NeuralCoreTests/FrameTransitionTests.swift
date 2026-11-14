import Foundation
import NeuralCore
import XCTest

final class FrameTransitionTests: XCTestCase {
  func testTransitionStartsAtDisplayedFrameAndEndsAtLiveDestination() {
    var transition = FrameTransition()
    let before = Data([200, 20, 0])
    let after = Data([0, 100, 200])
    transition.begin(from: before, time: 10, durationMs: 400)
    XCTAssertEqual(transition.apply(to: after, time: 10), before)
    XCTAssertEqual(transition.apply(to: after, time: 10.2), Data([100, 60, 100]))
    let live = Data([40, 60, 220])
    XCTAssertEqual(transition.apply(to: live, time: 10.5), live)
    XCTAssertFalse(transition.isActive)
  }

  func testRetargetContinuesFromCurrentBlendedFrame() {
    var transition = FrameTransition()
    transition.begin(from: Data([240, 0, 0]), time: 0, durationMs: 400)
    let displayed = transition.apply(to: Data([0, 240, 0]), time: 0.2)
    XCTAssertEqual(displayed, Data([120, 120, 0]))
    transition.begin(from: displayed, time: 0.2, durationMs: 400)
    XCTAssertEqual(transition.apply(to: Data([0, 0, 240]), time: 0.2), displayed)
    XCTAssertEqual(transition.apply(to: Data([0, 0, 240]), time: 0.4), Data([60, 60, 120]))
  }

  func testCancellationAndTopologyChangeNeverRetainOldPixels() {
    var transition = FrameTransition()
    transition.begin(from: Data([255, 255, 255]), time: 1, durationMs: 400)
    transition.cancel()
    XCTAssertEqual(transition.apply(to: Data([0, 0, 0]), time: 1.01), Data([0, 0, 0]))
    transition.begin(from: Data([255, 255, 255]), time: 1, durationMs: 400)
    let changed = Data([0, 0, 0, 1, 2, 3])
    XCTAssertEqual(transition.apply(to: changed, time: 1.01), changed)
    XCTAssertFalse(transition.isActive)
  }

  func testInvalidDurationsAndFramesDoNotStartTransitions() {
    var transition = FrameTransition()
    for duration in [0, -Double.infinity, Double.nan] {
      transition.begin(from: Data([255, 255, 255]), time: 0, durationMs: duration)
      XCTAssertFalse(transition.isActive)
    }
    transition.begin(from: Data([1]), time: 0, durationMs: 400)
    XCTAssertFalse(transition.isActive)
    transition.begin(from: Data([255, 255, 255]), time: 0, durationMs: 10_000)
    let destination = Data([0, 0, 0])
    XCTAssertEqual(transition.apply(to: destination, time: 0.601), destination)
  }
}
