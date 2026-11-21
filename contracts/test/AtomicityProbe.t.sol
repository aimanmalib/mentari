// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {QoreTest} from "./mocks/QoreTest.sol";
import {AtomicityProbe} from "../src/AtomicityProbe.sol";
import {CrossVm} from "../src/lib/CrossVm.sol";
import {ReceiptNote} from "../src/lib/ReceiptNote.sol";

contract AtomicityProbeTest is QoreTest {
    /// A real Native contract that is not on the bridge allowlist stands in for case D.
    string internal constant OFF_LIST = "qor1offlist";
    AtomicityProbe internal probe;

    function setUp() public {
        _installMocks();
        probe = new AtomicityProbe(RECEIPTS);
    }

    function test_constructorRejectsAnEmptyBook() public {
        vm.expectRevert(AtomicityProbe.EmptyReceiptsBook.selector);
        new AtomicityProbe("");
    }

    function test_recordThenRevertLeavesNoReceipt() public {
        vm.expectRevert(abi.encodeWithSelector(AtomicityProbe.RevertedAfterNativeWrite.selector, uint64(1)));
        probe.recordThenRevert("case B");
        assertEq(bridge.count(), 0);
        assertEq(bridge.receiptsBy(address(probe)), 0);
    }

    function test_nativeRefusesRevertsWithTheNativeReason() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                CrossVm.BridgeCallFailed.selector,
                abi.encodeWithSignature("Error(string)", "refused on purpose by the Native contract")
            )
        );
        probe.nativeRefuses();
        assertEq(bridge.count(), 0);
    }

    function test_callTargetOffTheAllowlistIsRefused() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                CrossVm.BridgeCallFailed.selector,
                abi.encodeWithSignature("Error(string)", "REFUSED by the bridge: qor1offlist is not allowlisted")
            )
        );
        probe.callTarget(OFF_LIST, "case D");
        assertEq(bridge.count(), 0);
    }

    function test_callTargetOnTheAllowlistWritesALabelledReceipt() public {
        vm.expectEmit(address(probe));
        emit AtomicityProbe.ProbeCalled(RECEIPTS, 1);
        assertEq(probe.callTarget(RECEIPTS, "control"), 1);
        assertEq(bridge.receipt(1).note, "PROBE control");
        assertEq(bridge.receipt(1).sender, address(probe));
    }

    function test_probeNotesFollowTheMemoRules() public {
        vm.expectRevert(ReceiptNote.BadMemo.selector);
        probe.recordThenRevert('"}},{"x":"');
        vm.expectRevert(ReceiptNote.BadMemo.selector);
        probe.callTarget(RECEIPTS, "line\nbreak");
        assertEq(bridge.count(), 0);
    }
}
