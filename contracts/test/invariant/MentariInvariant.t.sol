// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {MentariBase} from "../mentari/MentariBase.sol";
import {Mentari} from "../../src/Mentari.sol";
import {MentariHandler} from "./MentariHandler.sol";

/// The four product invariants (I1–I4), checked after every step of random handler sequences.
/// The handler only takes paths that must succeed, and wraps the ones that must fail in try/catch, so any
/// revert that reaches the fuzzer is a bug: fail-on-revert is on for this suite.
/// forge-config: default.invariant.fail-on-revert = true
contract MentariInvariantTest is MentariBase {
    uint256 internal constant METER_KEY_BASE = 100;
    uint256 internal constant PRODUCER_KEY_BASE = 200;
    MentariHandler internal handler;
    address[] internal ready;
    address[] internal notReady;

    function setUp() public override {
        super.setUp();
        address holder = makeAddr("holder");
        _giveKey(holder, 50);
        ready.push(alice);
        ready.push(holder);
        notReady.push(nobody);
        notReady.push(makeAddr("keyless"));

        for (uint32 id = 1; id <= 3; ++id) {
            address sysMeter = makeAddr(string.concat("meter", vm.toString(id)));
            address sysProducer = makeAddr(string.concat("producer", vm.toString(id)));
            _giveKey(sysMeter, METER_KEY_BASE + id);
            _giveKey(sysProducer, PRODUCER_KEY_BASE + id);
            uint32 capacityW = 1000 * id;
            mentari.registerSystem(
                id,
                sysMeter,
                sysProducer,
                capacityW,
                FIRST_DAY,
                _registerSig(id, sysMeter, sysProducer, capacityW, FIRST_DAY)
            );
            ready.push(sysProducer);
        }
        handler = new MentariHandler(mentari, FIRST_DAY, METER_KEY_BASE, ready, notReady);

        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = MentariHandler.attest.selector;
        selectors[1] = MentariHandler.transfer.selector;
        selectors[2] = MentariHandler.retire.selector;
        selectors[3] = MentariHandler.retireWhileBridgeFails.selector;
        selectors[4] = MentariHandler.nextDay.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// I1: minted minus retired equals supply, and supply is exactly what the actors hold.
    function invariant_mintedMinusRetiredIsSupply() public view {
        (uint256 minted, uint256 retired, uint256 supply) = mentari.totals();
        assertEq(minted - retired, supply);
        assertEq(minted, handler.ghostMinted());
        assertEq(retired, handler.ghostRetired());
        uint256 held;
        for (uint256 i; i < ready.length; ++i) {
            held += mentari.balanceOf(ready[i]);
        }
        assertEq(held, supply);
    }

    /// I2: the number of retirements equals the number of receipts the bridge accepted from this contract.
    function invariant_retirementsMatchReceipts() public view {
        assertEq(mentari.retirementsCount(), bridge.receiptsBy(address(mentari)));
        assertEq(mentari.retirementsCount(), handler.ghostRetirements());
    }

    /// I3: every retirement's receipt id is unique and strictly increasing, and the bridge holds that receipt
    /// with this contract as sender and the retirement's number and amount in the note.
    function invariant_receiptIdsUniqueAndIncreasing() public view {
        uint256 count = mentari.retirementsCount();
        uint64 last;
        for (uint256 n = 1; n <= count; ++n) {
            Mentari.Retirement memory r = mentari.retirement(n);
            assertGt(r.receiptId, last);
            last = r.receiptId;
            assertEq(bridge.receipt(r.receiptId).sender, address(mentari));
            string memory head = string.concat("MTR1 n=", vm.toString(n), " wh=", vm.toString(uint256(r.wh)), " ");
            assertEq(_prefix(bridge.receipt(r.receiptId).note, bytes(head).length), head);
        }
        assertEq(mentari.lastReceiptId(), last);
    }

    /// I4: no address without a proven quantum key holds certificates.
    function invariant_noBalanceWithoutQuantumKey() public view {
        for (uint256 i; i < notReady.length; ++i) {
            assertFalse(mentari.isQuantumReady(notReady[i]));
            assertEq(mentari.balanceOf(notReady[i]), 0);
        }
        assertEq(mentari.balanceOf(address(0)), 0);
        assertEq(mentari.balanceOf(address(mentari)), 0);
        assertEq(mentari.balanceOf(address(handler)), 0);
    }

    /// Every run must mint something; otherwise the invariants would only be checked on an empty contract.
    function afterInvariant() external view {
        assertGt(handler.calls("attest"), 0);
    }

    function _prefix(string memory s, uint256 len) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        if (b.length < len) return s;
        bytes memory out = new bytes(len);
        for (uint256 i; i < len; ++i) {
            out[i] = b[i];
        }
        return string(out);
    }
}
