// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint32, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title SeedDrawProbe
/// @notice Test-only: measures the two ways to draw six benchmark seeds (six euint32 against one
///         euint64 split after the reveal), with the same ACL work BenchmarkSeeds does. Not deployed.
contract SeedDrawProbe is ZamaEthereumConfig {
    mapping(uint256 => euint32[6]) private _six;
    mapping(uint256 => euint64) private _one;

    function drawSix(uint256 key) external {
        for (uint256 i = 0; i < 6; i++) {
            euint32 v = FHE.randEuint32();
            FHE.allowThis(v);
            FHE.allow(v, msg.sender);
            _six[key][i] = v;
        }
    }

    function drawOne(uint256 key) external {
        euint64 v = FHE.randEuint64();
        FHE.allowThis(v);
        FHE.allow(v, msg.sender);
        _one[key] = v;
    }
}
