// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {QoreTest} from "../mocks/QoreTest.sol";
import {Mentari} from "../../src/Mentari.sol";
import {MockCrossVmBridge} from "../mocks/MockCrossVmBridge.sol";

/// Drives Mentari through random sequences of readings, transfers, retirements, failing retirements and
/// days passing. Actors are the producers of three systems, two holders who are quantum
/// ready, and two addresses that never get a key. Ghost counters record what the handler saw succeed.
contract MentariHandler is QoreTest {
    uint32 internal constant SYSTEMS = 3;

    Mentari internal immutable m;
    uint256 internal immutable meterKeyBase;
    uint32 internal immutable firstDay;
    address[] internal _ready;
    address[] internal _notReady;

    uint256 public ghostMinted;
    uint256 public ghostRetired;
    uint256 public ghostRetirements;
    uint256 public failedRetirements;
    mapping(bytes32 => uint256) public calls;

    constructor(
        Mentari mentari_,
        uint32 firstDay_,
        uint256 meterKeyBase_,
        address[] memory ready,
        address[] memory notReady
    ) {
        m = mentari_;
        meterKeyBase = meterKeyBase_;
        firstDay = firstDay_;
        _ready = ready;
        _notReady = notReady;
    }

    function readyActors() external view returns (address[] memory) {
        return _ready;
    }

    function notReadyActors() external view returns (address[] memory) {
        return _notReady;
    }

    /// A meter reports a reading for an open day of its system. Days already attested are skipped.
    function attest(uint256 systemSeed, uint256 daySeed, uint64 wh) external {
        uint32 id = uint32(bound(systemSeed, 1, SYSTEMS));
        uint32 today = m.currentDay();
        uint32 day = uint32(bound(daySeed, firstDay, today - 1));
        if (m.attested(id, day)) return;
        wh = uint64(bound(wh, 1, m.maxWh(m.system(id).capacityW)));
        m.attest(id, day, wh, _sign(meterKeyBase + id, m.attestMessage(id, day, wh)));
        ghostMinted += wh;
        ++calls["attest"];
    }

    /// A holder moves part of their balance to another ready actor, or tries to send to an actor without a
    /// key, which must fail. A success is not reverted here: it stays in state for I4 to catch.
    function transfer(uint256 fromSeed, uint256 toSeed, uint256 wh, bool toNotReady) external {
        address from = _pick(_ready, fromSeed);
        uint256 balance = m.balanceOf(from);
        if (balance == 0) return;
        wh = bound(wh, 1, balance);
        vm.prank(from);
        if (toNotReady) {
            address to = _pick(_notReady, toSeed);
            try m.transfer(to, wh) {} catch {} // I4 sees any certificate that lands here
            ++calls["transferRefused"];
            return;
        }
        m.transfer(_pick(_ready, toSeed), wh);
        ++calls["transfer"];
    }

    /// A holder retires part of their balance with a short valid memo.
    function retire(uint256 fromSeed, uint256 wh) external {
        address from = _pick(_ready, fromSeed);
        uint256 balance = m.balanceOf(from);
        if (balance == 0) return;
        wh = bound(wh, 1, balance);
        vm.prank(from);
        m.retire(wh, "inv");
        ghostRetired += wh;
        ++ghostRetirements;
        ++calls["retire"];
    }

    /// A retirement while the bridge or the Native contract fails. It must revert and leave no trace; a success stays in state for I2 to catch.
    function retireWhileBridgeFails(uint256 fromSeed, uint256 wh, bool inactive) external {
        address from = _pick(_ready, fromSeed);
        uint256 balance = m.balanceOf(from);
        if (balance == 0) return;
        wh = bound(wh, 1, balance);
        bridge.setMode(inactive ? MockCrossVmBridge.Mode.Inactive : MockCrossVmBridge.Mode.TargetRefuses);
        vm.prank(from);
        try m.retire(wh, "inv") {} catch {} // I2 sees any retirement that slips through
        bridge.setMode(MockCrossVmBridge.Mode.Normal);
        ++failedRetirements;
        ++calls["retireFailed"];
    }

    /// One to three UTC days pass, opening new days for readings.
    function nextDay(uint256 days_) external {
        vm.warp(block.timestamp + bound(days_, 1, 3) * 1 days);
        ++calls["nextDay"];
    }

    function _pick(address[] storage list, uint256 seed) internal view returns (address) {
        return list[seed % list.length];
    }
}
