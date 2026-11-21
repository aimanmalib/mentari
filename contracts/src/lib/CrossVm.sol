// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title CrossVm
/// @notice Calls a QoreChain Native (CosmWasm) contract through the CrossVM bridge precompile, inside the
/// current EVM transaction. If the Native side fails, the whole transaction reverts; if the EVM side reverts
/// later, the Native write is undone with it.
/// @dev Follows the published bridge interface and the workshop 3 example (Apache-2.0, credited in NOTICE).
library CrossVm {
    /// The CrossVM bridge precompile.
    address internal constant BRIDGE = 0x0000000000000000000000000000000000000901;
    /// Target VM 1 = QoreChain Native (CosmWasm).
    uint8 internal constant NATIVE = 1;

    /// The bridge (or the Native contract) refused the call. `reason` is the revert data it returned.
    error BridgeCallFailed(bytes reason);
    /// The call returned no data: on a chain where the precompile is not active, a call to its address
    /// "succeeds" with an empty reply, so an empty reply is treated as "no bridge".
    error BridgeNotActive();
    /// The reply looked ABI-encoded but its length fields do not fit the returned data.
    error BridgeReplyMalformed();

    /// Executes `payload` (a JSON message) on the Native contract `target` (bech32 `qor1…`) and returns the
    /// Native reply bytes. Uses a normal `call`: the bridge refuses static calls and value.
    function callNative(string memory target, bytes memory payload) internal returns (bytes memory) {
        (bool ok, bytes memory ret) =
            BRIDGE.call(abi.encodeWithSignature("executeCrossVMCall(uint8,string,bytes)", NATIVE, target, payload));
        if (!ok) revert BridgeCallFailed(ret);
        if (ret.length == 0) revert BridgeNotActive();
        return unwrapReply(ret);
    }

    /// The bridge answers with the Native reply ABI-encoded as `bytes` (published interface). Older nodes
    /// returned the raw reply. A raw JSON reply starts with `{`, so its first word can never equal 32.
    function unwrapReply(bytes memory ret) internal pure returns (bytes memory reply) {
        uint256 offset;
        uint256 len;
        if (ret.length >= 64) {
            assembly ("memory-safe") {
                offset := mload(add(ret, 32))
                len := mload(add(ret, 64))
            }
        }
        if (offset != 32) return ret;
        // Fits in the returned data, padded to a whole word as the ABI requires.
        uint256 room = ret.length - 64;
        if (len > room || len + (32 - len % 32) % 32 > room) revert BridgeReplyMalformed();
        reply = new bytes(len);
        for (uint256 i; i < len; ++i) {
            reply[i] = ret[64 + i];
        }
    }
}
