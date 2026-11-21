// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {MentariBase} from "./MentariBase.sol";
import {Mentari} from "../../src/Mentari.sol";
import {Pqc} from "../../src/lib/Pqc.sol";

contract MentariAttestTest is MentariBase {
    function setUp() public override {
        super.setUp();
        _register();
    }

    /// Signs first: the signing helper is an external call and would take the expected revert.
    function _expectAttestRevert(uint32 day, uint64 wh, bytes memory err) internal {
        bytes memory sig = _sign(METER_KEY, mentari.attestMessage(SYSTEM, day, wh));
        vm.expectRevert(err);
        mentari.attest(SYSTEM, day, wh, sig);
    }

    function test_attestMessageIsTheDocumentedLayout() public view {
        bytes memory expected =
            abi.encodePacked("Mentari:attest:v1", block.chainid, address(mentari), SYSTEM, TODAY - 1, uint64(1234));
        assertEq(mentari.attestMessage(SYSTEM, TODAY - 1, 1234), expected);
    }

    function test_attestMintsToTheProducer() public {
        bytes memory sig = _sign(METER_KEY, mentari.attestMessage(SYSTEM, TODAY - 1, 1234));
        vm.expectEmit(address(mentari));
        emit Mentari.Transfer(address(0), producer, 1234);
        vm.expectEmit(address(mentari));
        emit Mentari.Attested(SYSTEM, TODAY - 1, 1234, producer);
        vm.prank(nobody); // anyone may submit a signed reading
        mentari.attest(SYSTEM, TODAY - 1, 1234, sig);
        assertEq(mentari.balanceOf(producer), 1234);
        assertEq(mentari.totalSupply(), 1234);
        assertTrue(mentari.attested(SYSTEM, TODAY - 1));
        assertFalse(mentari.attested(SYSTEM, TODAY - 2));
        (uint256 minted, uint256 retired, uint256 supply) = mentari.totals();
        assertEq(minted, 1234);
        assertEq(retired, 0);
        assertEq(supply, 1234);
    }

    function test_attestAcceptsTheFirstDayAndTheCapacityLimit() public {
        _attest(FIRST_DAY, MAX_WH);
        assertEq(mentari.maxWh(CAPACITY_W), MAX_WH);
        assertEq(mentari.balanceOf(producer), MAX_WH);
    }

    function test_attestRejectsAnUnknownSystem() public {
        vm.expectRevert(abi.encodeWithSelector(Mentari.UnknownSystem.selector, uint32(9)));
        mentari.attest(9, TODAY - 1, 1, new bytes(0));
    }

    function test_attestRejectsADayBeforeTheFirstDay() public {
        _expectAttestRevert(
            FIRST_DAY - 1, 1, abi.encodeWithSelector(Mentari.DayOutOfRange.selector, FIRST_DAY - 1, FIRST_DAY, TODAY)
        );
    }

    function test_attestRejectsTodayAndTheFuture() public {
        _expectAttestRevert(TODAY, 1, abi.encodeWithSelector(Mentari.DayOutOfRange.selector, TODAY, FIRST_DAY, TODAY));
        _expectAttestRevert(
            TODAY + 5, 1, abi.encodeWithSelector(Mentari.DayOutOfRange.selector, TODAY + 5, FIRST_DAY, TODAY)
        );
    }

    function test_attestAcceptsADayOnceItHasEnded() public {
        vm.warp(block.timestamp + 1 days);
        _attest(TODAY, 10);
        assertTrue(mentari.attested(SYSTEM, TODAY));
    }

    function test_attestRejectsTheSameDayTwice() public {
        bytes memory sig = _sign(METER_KEY, mentari.attestMessage(SYSTEM, TODAY - 1, 100));
        mentari.attest(SYSTEM, TODAY - 1, 100, sig);
        vm.expectRevert(abi.encodeWithSelector(Mentari.AlreadyAttested.selector, SYSTEM, TODAY - 1));
        mentari.attest(SYSTEM, TODAY - 1, 100, sig);
        _expectAttestRevert(TODAY - 1, 50, abi.encodeWithSelector(Mentari.AlreadyAttested.selector, SYSTEM, TODAY - 1));
        assertEq(mentari.totalSupply(), 100);
    }

    function test_attestRejectsZeroAndOverCapacity() public {
        _expectAttestRevert(TODAY - 1, 0, abi.encodeWithSelector(Mentari.WhOutOfRange.selector, uint64(0), MAX_WH));
        _expectAttestRevert(
            TODAY - 1, MAX_WH + 1, abi.encodeWithSelector(Mentari.WhOutOfRange.selector, MAX_WH + 1, MAX_WH)
        );
    }

    function test_attestRejectsASignatureByAnotherKey() public {
        bytes memory sig = _sign(PRODUCER_KEY, mentari.attestMessage(SYSTEM, TODAY - 1, 100));
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadSignature.selector, meter));
        mentari.attest(SYSTEM, TODAY - 1, 100, sig);
    }

    function test_attestRejectsAChangedReading() public {
        bytes memory sig = _sign(METER_KEY, mentari.attestMessage(SYSTEM, TODAY - 1, 100));
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadSignature.selector, meter));
        mentari.attest(SYSTEM, TODAY - 1, 101, sig);
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadSignature.selector, meter));
        mentari.attest(SYSTEM, TODAY - 2, 100, sig);
    }

    function test_attestRejectsASignatureForAnotherChain() public {
        bytes memory sig = _sign(METER_KEY, mentari.attestMessage(SYSTEM, TODAY - 1, 100));
        vm.chainId(block.chainid + 1);
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadSignature.selector, meter));
        mentari.attest(SYSTEM, TODAY - 1, 100, sig);
    }

    function test_attestRejectsASignatureForAnotherContract() public {
        Mentari other = new Mentari(registrar, RECEIPTS, SUN_X10);
        bytes memory sig = _sign(METER_KEY, other.attestMessage(SYSTEM, TODAY - 1, 100));
        vm.expectRevert(abi.encodeWithSelector(Pqc.BadSignature.selector, meter));
        mentari.attest(SYSTEM, TODAY - 1, 100, sig);
    }

    function test_attestRefusesToMintToAProducerThatLostItsKey() public {
        keys.setKey(producer, false, 0, "", false);
        _expectAttestRevert(TODAY - 1, 100, abi.encodeWithSelector(Mentari.NotQuantumReady.selector, producer));
    }
}

contract MentariTransferTest is MentariBase {
    function setUp() public override {
        super.setUp();
        _register();
        _attest(TODAY - 1, 1000);
    }

    function test_transferMovesCertificates() public {
        vm.expectEmit(address(mentari));
        emit Mentari.Transfer(producer, alice, 400);
        vm.prank(producer);
        assertTrue(mentari.transfer(alice, 400));
        assertEq(mentari.balanceOf(producer), 600);
        assertEq(mentari.balanceOf(alice), 400);
        assertEq(mentari.totalSupply(), 1000);
    }

    function test_transferRejectsARecipientWithoutAKey() public {
        vm.expectRevert(abi.encodeWithSelector(Mentari.NotQuantumReady.selector, nobody));
        vm.prank(producer);
        mentari.transfer(nobody, 1);
        vm.expectRevert(abi.encodeWithSelector(Mentari.NotQuantumReady.selector, address(0)));
        vm.prank(producer);
        mentari.transfer(address(0), 1);
    }

    function test_transferRejectsARecipientWithAnUnprovenKey() public {
        keys.setKey(nobody, true, 1, _pubkey(9), false);
        vm.expectRevert(abi.encodeWithSelector(Mentari.NotQuantumReady.selector, nobody));
        vm.prank(producer);
        mentari.transfer(nobody, 1);
    }

    function test_transferRejectsZero() public {
        vm.expectRevert(Mentari.ZeroAmount.selector);
        vm.prank(producer);
        mentari.transfer(alice, 0);
    }

    function test_transferRejectsMoreThanTheBalance() public {
        vm.expectRevert(abi.encodeWithSelector(Mentari.InsufficientBalance.selector, uint256(1000), uint256(1001)));
        vm.prank(producer);
        mentari.transfer(alice, 1001);
    }
}
