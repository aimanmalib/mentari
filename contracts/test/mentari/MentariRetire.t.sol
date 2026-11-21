// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {MentariBase} from "./MentariBase.sol";
import {Mentari} from "../../src/Mentari.sol";
import {MockCrossVmBridge} from "../mocks/MockCrossVmBridge.sol";
import {ReenteringBridge} from "../mocks/ReenteringBridge.sol";
import {CrossVm} from "../../src/lib/CrossVm.sol";
import {ReceiptNote} from "../../src/lib/ReceiptNote.sol";
import {ReceiptReply} from "../../src/lib/ReceiptReply.sol";

contract MentariRetireTest is MentariBase {
    function setUp() public override {
        super.setUp();
        _fundAlice(1000);
    }

    function test_retireBurnsAndWritesTheReceipt() public {
        string memory note = string.concat("MTR1 n=1 wh=300 by=", _hex(alice), " m=Roof 1");
        vm.expectEmit(address(mentari));
        emit Mentari.Transfer(alice, address(0), 300);
        vm.expectEmit(address(mentari));
        emit Mentari.Retired(1, alice, 300, 1, "Roof 1");
        vm.prank(alice);
        (uint256 n, uint64 receiptId) = mentari.retire(300, "Roof 1");

        assertEq(n, 1);
        assertEq(receiptId, 1);
        assertEq(mentari.balanceOf(alice), 700);
        assertEq(mentari.totalSupply(), 700);
        (uint256 minted, uint256 retired, uint256 supply) = mentari.totals();
        assertEq(minted, 1000);
        assertEq(retired, 300);
        assertEq(supply, 700);
        assertEq(mentari.retirementsCount(), 1);
        assertEq(mentari.lastReceiptId(), 1);

        Mentari.Retirement memory r = mentari.retirement(1);
        assertEq(r.holder, alice);
        assertEq(r.wh, 300);
        assertEq(r.receiptId, 1);
        assertEq(r.timestamp, block.timestamp);

        MockCrossVmBridge.Receipt memory receipt = bridge.receipt(1);
        assertEq(receipt.sender, address(mentari));
        assertEq(receipt.note, note);
        assertEq(bridge.receiptsBy(address(mentari)), 1);
    }

    function test_retirementsAreNumberedAndLinkedToIncreasingReceipts() public {
        vm.prank(alice);
        mentari.retire(1, "");
        // Another caller's receipt moves the book's counter past ours.
        vm.prank(address(0xBEEF));
        (bool ok,) = BRIDGE_ADDR.call(
            abi.encodeCall(MockCrossVmBridge.executeCrossVMCall, (1, RECEIPTS, bytes('{"record":{"note":"x"}}')))
        );
        assertTrue(ok);
        vm.prank(alice);
        (uint256 n, uint64 receiptId) = mentari.retire(2, "");
        assertEq(n, 2);
        assertEq(receiptId, 3);
        assertEq(mentari.retirement(2).receiptId, 3);
        assertEq(bridge.receiptsBy(address(mentari)), 2);
    }

    function test_retireAcceptsTheLongestMemo() public {
        string memory memo = "abcdefghijklmnopqrstuvwxyz0123456789 .:/";
        assertEq(bytes(memo).length, ReceiptNote.MAX_MEMO);
        vm.prank(alice);
        mentari.retire(1, memo);
        assertLe(bytes(bridge.receipt(1).note).length, ReceiptNote.MAX_NOTE);
    }

    function test_retireRejectsBadMemos() public {
        vm.startPrank(alice);
        vm.expectRevert(ReceiptNote.BadMemo.selector);
        mentari.retire(1, "abcdefghijklmnopqrstuvwxyz0123456789 .:/#");
        vm.expectRevert(ReceiptNote.BadMemo.selector);
        mentari.retire(1, 'x"}}');
        vm.expectRevert(ReceiptNote.BadMemo.selector);
        mentari.retire(1, "a\\b");
        vm.stopPrank();
        assertEq(bridge.count(), 0);
    }

    function test_retireRejectsZeroTooLargeAndOverBalance() public {
        vm.startPrank(alice);
        vm.expectRevert(Mentari.ZeroAmount.selector);
        mentari.retire(0, "");
        uint256 big = uint256(type(uint64).max) + 1;
        vm.expectRevert(abi.encodeWithSelector(Mentari.AmountTooLarge.selector, big));
        mentari.retire(big, "");
        vm.expectRevert(abi.encodeWithSelector(Mentari.InsufficientBalance.selector, uint256(1000), uint256(1001)));
        mentari.retire(1001, "");
        vm.stopPrank();
    }

    function test_nativeRefusalUndoesTheBurn() public {
        bridge.setMode(MockCrossVmBridge.Mode.TargetRefuses);
        vm.expectRevert(
            abi.encodeWithSelector(
                CrossVm.BridgeCallFailed.selector,
                abi.encodeWithSignature("Error(string)", "refused by the Native contract")
            )
        );
        vm.prank(alice);
        mentari.retire(300, "");
        _assertNothingRetired();
    }

    function test_inactiveBridgeUndoesTheBurn() public {
        bridge.setMode(MockCrossVmBridge.Mode.Inactive);
        vm.expectRevert(CrossVm.BridgeNotActive.selector);
        vm.prank(alice);
        mentari.retire(300, "");
        _assertNothingRetired();
    }

    function test_unreadableReplyUndoesTheBurn() public {
        bridge.setCustomReply('{"id":"1"}');
        vm.expectRevert(ReceiptReply.BadReply.selector);
        vm.prank(alice);
        mentari.retire(300, "");
        _assertNothingRetired();
    }

    function test_retireRejectsAReceiptIdThatDoesNotIncrease() public {
        bridge.setCustomReply('{"id":5}');
        vm.prank(alice);
        mentari.retire(1, "");
        vm.expectRevert(abi.encodeWithSelector(Mentari.ReceiptIdNotIncreasing.selector, uint64(5), uint64(5)));
        vm.prank(alice);
        mentari.retire(1, "");
        bridge.setCustomReply('{"id":4}');
        vm.expectRevert(abi.encodeWithSelector(Mentari.ReceiptIdNotIncreasing.selector, uint64(4), uint64(5)));
        vm.prank(alice);
        mentari.retire(1, "");
        assertEq(mentari.retirementsCount(), 1);
    }

    function test_aBookOffTheAllowlistIsRefused() public {
        string memory book = "qor1notallowlisted";
        Mentari other = new Mentari(registrar, book, SUN_X10);
        mentari = other;
        _fundAlice(10);
        vm.expectRevert(
            abi.encodeWithSelector(
                CrossVm.BridgeCallFailed.selector,
                abi.encodeWithSignature("Error(string)", "REFUSED by the bridge: qor1notallowlisted is not allowlisted")
            )
        );
        vm.prank(alice);
        other.retire(10, "");
        assertEq(other.balanceOf(alice), 10);
    }

    function test_retireCannotBeReenteredFromTheBridge() public {
        vm.etch(BRIDGE_ADDR, address(new ReenteringBridge()).code);
        vm.expectRevert(
            abi.encodeWithSelector(
                CrossVm.BridgeCallFailed.selector, abi.encodeWithSelector(Mentari.Reentrancy.selector)
            )
        );
        vm.prank(alice);
        mentari.retire(300, "");
        assertEq(mentari.balanceOf(alice), 1000);
    }

    function test_retirementViewRejectsUnknownNumbers() public {
        vm.expectRevert(abi.encodeWithSelector(Mentari.UnknownRetirement.selector, uint256(0)));
        mentari.retirement(0);
        vm.expectRevert(abi.encodeWithSelector(Mentari.UnknownRetirement.selector, uint256(1)));
        mentari.retirement(1);
    }

    function _assertNothingRetired() internal view {
        assertEq(mentari.balanceOf(alice), 1000);
        assertEq(mentari.totalSupply(), 1000);
        assertEq(mentari.retirementsCount(), 0);
        assertEq(mentari.lastReceiptId(), 0);
        assertEq(bridge.count(), 0);
    }
}
