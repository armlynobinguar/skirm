// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE} from "@fhevm/solidity/lib/FHE.sol";
import {ISkirmMatchLadder, PrivateLadder} from "../PrivateLadder.sol";

/// @title PrivateLadderHarness
/// @notice Test-only: PrivateLadder with a way to place a registered player at a given rating, so
///         the clamps and tier thresholds can be tested without hundreds of matches. Not deployed.
contract PrivateLadderHarness is PrivateLadder {
    constructor(ISkirmMatchLadder skirmMatch_, address operator_, uint16 matchWindow_) PrivateLadder(skirmMatch_, operator_, matchWindow_) {}

    /// @notice Sets `player`'s rating (a trivially encrypted value) and recomputes its tier.
    function setRatingForTest(address player, uint16 rating) external {
        if (!this.playerOf(player).registered) revert NotRegistered(player);
        _store(player, FHE.asEuint16(rating));
        _setTier(player);
    }
}
