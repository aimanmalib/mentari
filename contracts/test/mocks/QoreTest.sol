// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockCrossVmBridge} from "./MockCrossVmBridge.sol";
import {MockPqc} from "./MockPqc.sol";

/// Base test: installs the bridge and post-quantum mocks at the precompile addresses.
abstract contract QoreTest is Test {
    address internal constant BRIDGE_ADDR = 0x0000000000000000000000000000000000000901;
    address internal constant VERIFY_ADDR = 0x0000000000000000000000000000000000000a01;
    address internal constant KEYS_ADDR = 0x0000000000000000000000000000000000000a02;
    /// The `qday-receipts` book on the testnet allowlist (code 865).
    string internal constant RECEIPTS = "qor1xjayq5ev55tkzpml9klxwyshr7gdrha0nurha9jhm0f0gdckksgs3gltw8";

    MockCrossVmBridge internal bridge = MockCrossVmBridge(BRIDGE_ADDR);
    MockPqc internal keys = MockPqc(KEYS_ADDR);

    function _installMocks() internal {
        vm.etch(BRIDGE_ADDR, address(new MockCrossVmBridge()).code);
        address pqc = address(new MockPqc());
        vm.etch(VERIFY_ADDR, pqc.code);
        vm.etch(KEYS_ADDR, pqc.code);
        bridge.allow(RECEIPTS);
    }

    /// A deterministic 2592-byte "public key" for `seed`.
    function _pubkey(uint256 seed) internal pure returns (bytes memory k) {
        k = new bytes(2592);
        for (uint256 i; i < 2592; i += 32) {
            bytes32 w = keccak256(abi.encode(seed, i));
            for (uint256 j; j < 32 && i + j < 2592; ++j) {
                k[i + j] = w[j];
            }
        }
    }

    /// Registers a possession-proven ML-DSA-87 key for `account`, derived from `seed`.
    function _giveKey(address account, uint256 seed) internal returns (bytes memory pubkey) {
        pubkey = _pubkey(seed);
        keys.setKey(account, true, 1, pubkey, true);
    }

    function _sign(uint256 seed, bytes memory message) internal view returns (bytes memory) {
        return keys.sign(_pubkey(seed), message);
    }
}
