// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LibHarness} from "../mocks/LibHarness.sol";
import {ReceiptNote} from "../../src/lib/ReceiptNote.sol";

contract ReceiptNoteTest is Test {
    LibHarness internal h;
    address internal constant HOLDER = 0x9dEF414277275054bF585EAE1Cc6A4b2b673078B;

    function setUp() public {
        h = new LibHarness();
    }

    function test_noteHasTheExactFormat() public view {
        assertEq(
            h.note(7, 1500, HOLDER, "roof #2 - may"),
            "MTR1 n=7 wh=1500 by=0x9def414277275054bf585eae1cc6a4b2b673078b m=roof #2 - may"
        );
    }

    function test_emptyMemoAndZeroValues() public view {
        assertEq(h.note(0, 0, address(0), ""), "MTR1 n=0 wh=0 by=0x0000000000000000000000000000000000000000 m=");
    }

    function test_longestNoteIsExactlyTheLimit() public view {
        string memory memo = "abcdefghijklmnopqrstuvwxyz0123456789ABCD";
        assertEq(bytes(memo).length, ReceiptNote.MAX_MEMO);
        string memory n = h.note(type(uint64).max, type(uint64).max, address(type(uint160).max), memo);
        assertEq(bytes(n).length, ReceiptNote.MAX_NOTE);
    }

    function test_everyAllowedMemoCharacter() public view {
        assertTrue(h.isValidMemo("AZaz09 .:/#-"));
        assertTrue(h.isValidMemo(""));
    }

    function test_memoLongerThanTheLimitIsRefused() public {
        string memory memo = "abcdefghijklmnopqrstuvwxyz0123456789ABCDE";
        assertFalse(h.isValidMemo(memo));
        vm.expectRevert(ReceiptNote.BadMemo.selector);
        h.note(1, 1, HOLDER, memo);
    }

    function test_injectionCharactersAreRefused() public {
        string[8] memory bad = ['x"}},"fail":{"', "back\\slash", "new\nline", "tab\t", "{", "_", "%", unicode"é"];
        for (uint256 i; i < bad.length; ++i) {
            assertFalse(h.isValidMemo(bad[i]));
            vm.expectRevert(ReceiptNote.BadMemo.selector);
            h.note(1, 1, HOLDER, bad[i]);
        }
    }

    function test_lonePlainQuoteIsRefused() public {
        assertFalse(h.isValidMemo('a"b'));
        vm.expectRevert(ReceiptNote.BadMemo.selector);
        h.note(1, 1, HOLDER, 'a"b');
    }

    /// Every one of the 256 byte values, placed alone inside an otherwise valid memo, is accepted
    /// exactly when it is in the published alphabet. The oracle is the literal list, not the library.
    function test_everyByteValueMatchesTheAlphabet() public view {
        bytes memory alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .:/#-";
        for (uint256 v; v < 256; ++v) {
            bool listed;
            for (uint256 j; j < alphabet.length; ++j) {
                if (uint8(alphabet[j]) == v) listed = true;
            }
            bytes memory memo = abi.encodePacked("a", bytes1(uint8(v)), "b");
            assertEq(h.isValidMemo(string(memo)), listed, string(abi.encodePacked("byte ", vm.toString(v))));
        }
    }

    function test_recordPayloadWrapsTheNote() public view {
        assertEq(h.recordPayload("MTR1 n=1"), bytes('{"record":{"note":"MTR1 n=1"}}'));
    }

    /// Any memo either is refused, or yields a message whose only quotes, backslashes and control
    /// characters are the ones in the fixed `{"record":{"note":"…"}}` frame, and a note within the limit.
    function testFuzz_noteCannotBreakTheMessage(uint64 n, uint64 wh, address by, bytes memory memo) public view {
        try h.note(n, wh, by, string(memo)) returns (string memory text) {
            assertLe(bytes(text).length, ReceiptNote.MAX_NOTE);
            bytes memory p = h.recordPayload(text);
            uint256 quotes;
            for (uint256 i; i < p.length; ++i) {
                assertTrue(p[i] != "\\" && uint8(p[i]) >= 0x20 && uint8(p[i]) < 0x7f);
                if (p[i] == '"') ++quotes;
            }
            assertEq(quotes, 6);
        } catch (bytes memory err) {
            assertEq(bytes4(err), ReceiptNote.BadMemo.selector);
            assertFalse(h.isValidMemo(string(memo)));
        }
    }

    /// A memo built only from allowed characters is always accepted, and appears verbatim at the end.
    function testFuzz_allowedMemoIsKeptVerbatim(uint64 n, uint64 wh, bytes32 seed, uint8 len) public view {
        bytes memory alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .:/#-";
        bytes memory memo = new bytes(len % 41);
        for (uint256 i; i < memo.length; ++i) {
            memo[i] = alphabet[uint8(seed[i % 32]) % alphabet.length];
        }
        bytes memory text = bytes(h.note(n, wh, HOLDER, string(memo)));
        assertLe(text.length, ReceiptNote.MAX_NOTE);
        for (uint256 i; i < memo.length; ++i) {
            assertEq(text[text.length - memo.length + i], memo[i]);
        }
    }
}
