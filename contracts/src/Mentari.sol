// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {CrossVm} from "./lib/CrossVm.sol";
import {Pqc} from "./lib/Pqc.sol";
import {ReceiptNote} from "./lib/ReceiptNote.sol";
import {ReceiptReply} from "./lib/ReceiptReply.sol";

/// @title Mentari
/// @notice Solar energy certificates. One unit (MTR) is one watt-hour. A meter signs each day's reading with its
/// ML-DSA-87 key and the reading is minted to the system's producer. Retiring certificates burns them and, in the
/// same transaction, writes a receipt into the Native `qday-receipts` book through the CrossVM bridge. If the
/// Native write fails, the burn is undone; if the burn fails, the receipt is undone.
/// @dev No owner, no pause, no upgrade, no allowances, no value. Authority comes from post-quantum signatures
/// checked with the chain's `pqcVerify` and `pqcKeyStatus` precompiles, not from `msg.sender`.
contract Mentari {
    struct System {
        address meter;
        address producer;
        uint32 capacityW;
        uint32 firstDay;
    }

    struct Retirement {
        address holder;
        uint64 wh;
        uint64 receiptId;
        uint64 timestamp;
    }

    string public constant name = "Mentari Solar Watt-hour";
    string public constant symbol = "MTR";
    uint8 public constant decimals = 0;
    /// Upper bound for `maxSunHoursX10`: 24 hours of full sun.
    uint16 public constant MAX_SUN_HOURS_X10_LIMIT = 240;

    /// The account whose ML-DSA-87 key signs system registrations.
    address public immutable registrar;
    /// A day's reading may not exceed capacity times this many hours, in tenths of an hour.
    uint16 public immutable maxSunHoursX10;
    /// The Native receipts book (bech32 `qor1…`) that retirements write to.
    string public receiptsBook;

    /// Number of registrations accepted so far; part of the next registration message.
    uint256 public nonce;
    uint256 public totalSupply;
    uint256 public minted;
    uint256 public retired;
    /// The highest receipt id the book has returned to this contract.
    uint64 public lastReceiptId;

    mapping(address => uint256) public balanceOf;
    mapping(uint32 => System) internal _systems;
    mapping(uint32 => mapping(uint32 => bool)) internal _attested;
    Retirement[] internal _retirements;
    uint256 private _lock = 1;

    event SystemRegistered(
        uint32 indexed id, address indexed meter, address indexed producer, uint32 capacityW, uint32 firstDay
    );
    event Attested(uint32 indexed id, uint32 indexed day, uint64 wh, address indexed producer);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Retired(uint256 indexed n, address indexed holder, uint256 wh, uint64 indexed receiptId, string memo);

    error ZeroAddress();
    error EmptyReceiptsBook();
    error BadMaxSunHours(uint16 value);
    error ZeroCapacity();
    error SystemExists(uint32 id);
    error UnknownSystem(uint32 id);
    error NotQuantumReady(address account);
    error DayOutOfRange(uint32 day, uint32 firstDay, uint32 today);
    error AlreadyAttested(uint32 id, uint32 day);
    error WhOutOfRange(uint64 wh, uint64 max);
    error ZeroAmount();
    error AmountTooLarge(uint256 wh);
    error InsufficientBalance(uint256 balance, uint256 needed);
    error ReceiptIdNotIncreasing(uint64 id, uint64 last);
    error UnknownRetirement(uint256 n);
    error Reentrancy();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address registrar_, string memory receiptsBook_, uint16 maxSunHoursX10_) {
        if (registrar_ == address(0)) revert ZeroAddress();
        if (bytes(receiptsBook_).length == 0) revert EmptyReceiptsBook();
        if (maxSunHoursX10_ == 0 || maxSunHoursX10_ > MAX_SUN_HOURS_X10_LIMIT) {
            revert BadMaxSunHours(maxSunHoursX10_);
        }
        registrar = registrar_;
        receiptsBook = receiptsBook_;
        maxSunHoursX10 = maxSunHoursX10_;
    }

    // ---------------------------------------------------------------- systems and readings

    /// Registers solar system `id`, signed by the registrar's ML-DSA-87 key over `registerMessage(...)`.
    /// Anyone may submit it. The meter and the producer must both be quantum ready.
    function registerSystem(
        uint32 id,
        address meter,
        address producer,
        uint32 capacityW,
        uint32 firstDay,
        bytes calldata sig
    ) external {
        if (capacityW == 0) revert ZeroCapacity();
        if (_systems[id].capacityW != 0) revert SystemExists(id);
        _requireQuantumReady(meter);
        _requireQuantumReady(producer);
        Pqc.requireSignature(registrar, registerMessage(id, meter, producer, capacityW, firstDay), sig);
        ++nonce;
        _systems[id] = System(meter, producer, capacityW, firstDay);
        emit SystemRegistered(id, meter, producer, capacityW, firstDay);
    }

    /// Mints `wh` to system `id`'s producer for the finished UTC `day`, signed by the system's meter key over
    /// `attestMessage(id, day, wh)`. Anyone may submit it. Each day can be attested once.
    function attest(uint32 id, uint32 day, uint64 wh, bytes calldata sig) external {
        System memory s = _systems[id];
        if (s.capacityW == 0) revert UnknownSystem(id);
        uint32 today = currentDay();
        if (day < s.firstDay || day >= today) revert DayOutOfRange(day, s.firstDay, today);
        if (_attested[id][day]) revert AlreadyAttested(id, day);
        uint64 max = maxWh(s.capacityW);
        if (wh == 0 || wh > max) revert WhOutOfRange(wh, max);
        _requireQuantumReady(s.producer);
        Pqc.requireSignature(s.meter, attestMessage(id, day, wh), sig);
        _attested[id][day] = true;
        minted += wh;
        totalSupply += wh;
        balanceOf[s.producer] += wh;
        emit Transfer(address(0), s.producer, wh);
        emit Attested(id, day, wh, s.producer);
    }

    // ---------------------------------------------------------------- certificates

    /// Moves `wh` certificates to `to`, which must be quantum ready. There are no allowances.
    function transfer(address to, uint256 wh) external returns (bool) {
        if (wh == 0) revert ZeroAmount();
        _requireQuantumReady(to);
        _burnFrom(msg.sender, wh);
        balanceOf[to] += wh;
        emit Transfer(msg.sender, to, wh);
        return true;
    }

    /// Burns `wh` of the caller's certificates and writes a receipt to the Native book in the same transaction.
    /// The memo is 0 to 40 characters from `[A-Za-z0-9 .:/#-]` (`ReceiptNote.BadMemo` otherwise).
    /// Returns the retirement number and the Native receipt id. Any bridge failure reverts everything.
    function retire(uint256 wh, string calldata memo) external nonReentrant returns (uint256 n, uint64 receiptId) {
        if (wh == 0) revert ZeroAmount();
        if (wh > type(uint64).max) revert AmountTooLarge(wh);
        _burnFrom(msg.sender, wh);
        totalSupply -= wh;
        retired += wh;
        emit Transfer(msg.sender, address(0), wh);

        n = _retirements.length + 1;
        // forge-lint: disable-next-line(unsafe-typecast) checked against type(uint64).max above
        uint64 amount = uint64(wh);
        // forge-lint: disable-next-line(unsafe-typecast) one retirement per transaction cannot reach 2^64
        string memory noteText = ReceiptNote.note(uint64(n), amount, msg.sender, memo);
        bytes memory reply = CrossVm.callNative(receiptsBook, ReceiptNote.recordPayload(noteText));
        receiptId = ReceiptReply.readId(reply);
        if (receiptId <= lastReceiptId) revert ReceiptIdNotIncreasing(receiptId, lastReceiptId);
        lastReceiptId = receiptId;
        // forge-lint: disable-next-line(unsafe-typecast) seconds since 1970 fit in 64 bits for billions of years
        _retirements.push(Retirement(msg.sender, amount, receiptId, uint64(block.timestamp)));
        // The receipt id is only known after the bridge call. The call goes to the bridge precompile and this
        // function is guarded by `nonReentrant`, so the event cannot be reordered.
        // forge-lint: disable-next-line(reentrancy-events)
        emit Retired(n, msg.sender, wh, receiptId, memo);
    }

    // ---------------------------------------------------------------- views

    /// The bytes the registrar signs to register a system. Includes the chain, this contract and `nonce`.
    function registerMessage(uint32 id, address meter, address producer, uint32 capacityW, uint32 firstDay)
        public
        view
        returns (bytes memory)
    {
        return abi.encodePacked(
            "Mentari:register:v1", block.chainid, address(this), nonce, id, meter, producer, capacityW, firstDay
        );
    }

    /// The bytes a meter signs for one day's reading. Includes the chain and this contract.
    function attestMessage(uint32 id, uint32 day, uint64 wh) public view returns (bytes memory) {
        return abi.encodePacked("Mentari:attest:v1", block.chainid, address(this), id, day, wh);
    }

    /// The current UTC day number (days since 1970-01-01).
    function currentDay() public view returns (uint32) {
        // forge-lint: disable-next-line(unsafe-typecast) 2^32 days is about 11 million years
        return uint32(block.timestamp / 1 days);
    }

    /// The largest reading a system of `capacityW` watts may report for one day.
    function maxWh(uint32 capacityW) public view returns (uint64) {
        return uint64(capacityW) * maxSunHoursX10 / 10;
    }

    function system(uint32 id) external view returns (System memory) {
        System memory s = _systems[id];
        if (s.capacityW == 0) revert UnknownSystem(id);
        return s;
    }

    function attested(uint32 id, uint32 day) external view returns (bool) {
        return _attested[id][day];
    }

    /// Retirement number `n`, counting from 1.
    function retirement(uint256 n) external view returns (Retirement memory) {
        if (n == 0 || n > _retirements.length) revert UnknownRetirement(n);
        return _retirements[n - 1];
    }

    function retirementsCount() external view returns (uint256) {
        return _retirements.length;
    }

    /// Certificates minted, retired, and still in supply. Minted minus retired always equals supply.
    function totals() external view returns (uint256 minted_, uint256 retired_, uint256 supply) {
        return (minted, retired, totalSupply);
    }

    /// True when `account` has a registered, possession-proven ML-DSA-87 key.
    function isQuantumReady(address account) external view returns (bool) {
        return Pqc.isQuantumReady(account);
    }

    // ---------------------------------------------------------------- internal

    function _requireQuantumReady(address account) private view {
        if (!Pqc.isQuantumReady(account)) revert NotQuantumReady(account);
    }

    function _burnFrom(address from, uint256 wh) private {
        uint256 balance = balanceOf[from];
        if (balance < wh) revert InsufficientBalance(balance, wh);
        unchecked {
            balanceOf[from] = balance - wh;
        }
    }
}
