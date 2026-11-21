// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {MentariBase} from "./MentariBase.sol";
import {Mentari} from "../../src/Mentari.sol";
import {MockCrossVmBridge} from "../mocks/MockCrossVmBridge.sol";
import {ReceiptNote} from "../../src/lib/ReceiptNote.sol";
import {ReceiptReply} from "../../src/lib/ReceiptReply.sol";

/// Fuzz tests through the product contract, end to end with the bridge and key mocks.
contract MentariFuzzTest is MentariBase {
    uint64 internal constant FUNDED = 30_000;

    function setUp() public override {
        super.setUp();
        _fundAlice(FUNDED);
    }

    /// `attest` refuses every reading of zero or above capacity times the sun-hour limit, for any capacity.
    function testFuzz_attestRefusesWhOutOfRange(uint32 capacityW, uint64 wh) public {
        capacityW = uint32(bound(capacityW, 1, type(uint32).max));
        uint64 max = mentari.maxWh(capacityW);
        vm.assume(wh == 0 || wh > max);
        uint32 id = 2;
        mentari.registerSystem(
            id, meter, producer, capacityW, FIRST_DAY, _registerSig(id, meter, producer, capacityW, FIRST_DAY)
        );
        bytes memory sig = _sign(METER_KEY, mentari.attestMessage(id, TODAY - 1, wh));
        vm.expectRevert(abi.encodeWithSelector(Mentari.WhOutOfRange.selector, wh, max));
        mentari.attest(id, TODAY - 1, wh, sig);
        assertFalse(mentari.attested(id, TODAY - 1));
    }

    /// Every reading from 1 to the limit mints exactly that amount to the producer.
    function testFuzz_attestMintsAnyWhInRange(uint64 wh, uint32 back) public {
        wh = uint64(bound(wh, 1, MAX_WH));
        uint32 day = TODAY - uint32(bound(back, 2, TODAY - FIRST_DAY));
        uint256 before = mentari.balanceOf(producer);
        _attest(day, wh);
        assertEq(mentari.balanceOf(producer), before + wh);
        assertEq(mentari.minted(), uint256(FUNDED) + wh);
        assertTrue(mentari.attested(SYSTEM, day));
    }

    /// A reading signed for another chain or another deployment is refused.
    function testFuzz_attestSignatureBoundToChainAndContract(uint64 chainId, address other) public {
        vm.assume(chainId != block.chainid && chainId != 0);
        vm.assume(other != address(mentari));
        uint32 day = TODAY - 2;
        uint64 wh = 100;
        bytes memory msgHere = mentari.attestMessage(SYSTEM, day, wh);
        bytes memory otherChain =
            abi.encodePacked("Mentari:attest:v1", uint256(chainId), address(mentari), SYSTEM, day, wh);
        bytes memory otherContract = abi.encodePacked("Mentari:attest:v1", block.chainid, other, SYSTEM, day, wh);
        assertTrue(keccak256(msgHere) != keccak256(otherChain));
        assertTrue(keccak256(msgHere) != keccak256(otherContract));
        bytes memory sig1 = _sign(METER_KEY, otherChain);
        bytes memory sig2 = _sign(METER_KEY, otherContract);
        vm.expectRevert();
        mentari.attest(SYSTEM, day, wh, sig1);
        vm.expectRevert();
        mentari.attest(SYSTEM, day, wh, sig2);
        assertFalse(mentari.attested(SYSTEM, day));
    }

    /// For any memo bytes, `retire` either refuses the memo and changes nothing, or writes a note of at most
    /// 140 characters with no quote, backslash or control character, so the JSON frame stays fixed.
    function testFuzz_retireMemoCannotBreakThePayload(uint256 wh, bytes memory memo) public {
        wh = bound(wh, 1, FUNDED);
        vm.prank(alice);
        try mentari.retire(wh, string(memo)) returns (uint256 n, uint64 receiptId) {
            assertEq(n, 1);
            bytes memory note = bytes(bridge.receipt(receiptId).note);
            assertLe(note.length, ReceiptNote.MAX_NOTE);
            for (uint256 i; i < note.length; ++i) {
                assertTrue(note[i] != '"' && note[i] != "\\" && uint8(note[i]) >= 0x20 && uint8(note[i]) < 0x7f);
            }
            assertEq(mentari.balanceOf(alice), FUNDED - wh);
        } catch (bytes memory err) {
            assertEq(bytes4(err), ReceiptNote.BadMemo.selector);
            _assertUntouched();
        }
    }

    /// Any amount up to the balance retires; any amount above it is refused with nothing written.
    function testFuzz_retireBurnsExactlyOrNothing(uint256 wh) public {
        vm.assume(wh != 0);
        vm.prank(alice);
        if (wh > FUNDED) {
            vm.expectRevert();
            mentari.retire(wh, "x");
            _assertUntouched();
            return;
        }
        mentari.retire(wh, "x");
        (uint256 minted, uint256 retired, uint256 supply) = mentari.totals();
        assertEq(retired, wh);
        assertEq(minted - retired, supply);
        assertEq(bridge.receiptsBy(address(mentari)), 1);
    }

    /// Whatever bytes the bridge replies with, the contract either reads a valid id or rolls back the burn.
    function testFuzz_badReplyRollsBackTheBurn(bytes memory reply, uint256 wh) public {
        wh = bound(wh, 1, FUNDED);
        bridge.setCustomReply(reply);
        vm.prank(alice);
        try mentari.retire(wh, "x") returns (uint256, uint64 receiptId) {
            assertGt(receiptId, 0);
            assertEq(mentari.retired(), wh);
        } catch (bytes memory err) {
            assertEq(bytes4(err), ReceiptReply.BadReply.selector);
            _assertUntouched();
        }
    }

    /// Whichever bridge failure happens, the burn is undone and no retirement is recorded.
    function testFuzz_bridgeFailureRollsBackTheBurn(uint8 modeSeed, uint256 wh) public {
        wh = bound(wh, 1, FUNDED);
        MockCrossVmBridge.Mode mode =
            modeSeed % 2 == 0 ? MockCrossVmBridge.Mode.TargetRefuses : MockCrossVmBridge.Mode.Inactive;
        bridge.setMode(mode);
        vm.prank(alice);
        vm.expectRevert();
        mentari.retire(wh, "x");
        _assertUntouched();
    }

    /// Transfers move certificates between quantum-ready accounts without changing supply, and never to an
    /// account without a proven key.
    function testFuzz_transferConservesSupply(uint256 wh, address to, bool pickReady) public {
        wh = bound(wh, 1, FUNDED);
        if (pickReady) to = producer;
        vm.assume(to != alice);
        bool ready = mentari.isQuantumReady(to);
        uint256 before = mentari.balanceOf(to);
        vm.prank(alice);
        if (!ready) {
            vm.expectRevert(abi.encodeWithSelector(Mentari.NotQuantumReady.selector, to));
            mentari.transfer(to, wh);
            assertEq(mentari.balanceOf(to), before);
        } else {
            mentari.transfer(to, wh);
            assertEq(mentari.balanceOf(to), before + wh);
        }
        assertEq(mentari.balanceOf(alice) + mentari.balanceOf(to) - before, FUNDED);
        assertEq(mentari.totalSupply(), FUNDED);
    }

    /// Balances, totals, retirement list and receipt book are exactly as after set-up.
    function _assertUntouched() internal view {
        assertEq(mentari.balanceOf(alice), FUNDED);
        assertEq(mentari.totalSupply(), FUNDED);
        assertEq(mentari.retired(), 0);
        assertEq(mentari.retirementsCount(), 0);
        assertEq(mentari.lastReceiptId(), 0);
        assertEq(bridge.receiptsBy(address(mentari)), 0);
    }
}
