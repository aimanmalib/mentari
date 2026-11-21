// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

// DEMO FIXTURE, NOT PART OF THE PRODUCT. This contract exists only to show, on the testnet, that a CrossVM call is
// atomic: each function makes the bridge call in a way that must fail, and the evidence records that the Native
// receipts book did not change. It holds no certificates and no funds. The product contract is `Mentari`.

import {CrossVm} from "./lib/CrossVm.sol";
import {ReceiptNote} from "./lib/ReceiptNote.sol";
import {ReceiptReply} from "./lib/ReceiptReply.sol";

/// @title AtomicityProbe
/// @notice Demo fixture for the atomicity cases (see the comment at the top of this file).
contract AtomicityProbe {
    /// The Native receipts book (bech32 `qor1…`) that `recordThenRevert` and `nativeRefuses` call.
    string public receiptsBook;

    /// Emitted when `callTarget` reaches a target that accepts the record (expected only for the receipts book).
    event ProbeCalled(string target, uint64 receiptId);

    error EmptyReceiptsBook();
    /// Raised on purpose after the Native book has stored receipt `receiptId`; the revert undoes that write.
    error RevertedAfterNativeWrite(uint64 receiptId);

    constructor(string memory receiptsBook_) {
        if (bytes(receiptsBook_).length == 0) revert EmptyReceiptsBook();
        receiptsBook = receiptsBook_;
    }

    /// Case B: writes a receipt with `note`, then reverts. The receipt count must be the same before and after.
    /// `note` follows the memo rules (0 to 40 characters from `[A-Za-z0-9 .:/#-]`).
    function recordThenRevert(string calldata note) external {
        bytes memory reply = CrossVm.callNative(receiptsBook, _record(note));
        revert RevertedAfterNativeWrite(ReceiptReply.readId(reply));
    }

    /// Case C: sends a message the receipts book refuses, so the bridge call (and the transaction) fails.
    function nativeRefuses() external {
        CrossVm.callNative(receiptsBook, '{"fail":{}}');
    }

    /// Case D: sends a record to any `target`. A Native contract that is not on the bridge allowlist is refused.
    function callTarget(string calldata target, string calldata note) external returns (uint64 receiptId) {
        receiptId = ReceiptReply.readId(CrossVm.callNative(target, _record(note)));
        // The receipt id is only known after the bridge call; this fixture keeps no state to protect.
        // forge-lint: disable-next-line(reentrancy-events)
        emit ProbeCalled(target, receiptId);
    }

    function _record(string calldata note) private pure returns (bytes memory) {
        if (!ReceiptNote.isValidMemo(note)) revert ReceiptNote.BadMemo();
        return ReceiptNote.recordPayload(string.concat("PROBE ", note));
    }
}
