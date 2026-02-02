import { zeroAddress } from "viem";
export const ADDRESS_ZERO = zeroAddress;
export var ErrorReason;
(function (ErrorReason) {
    ErrorReason["InvalidSignature"] = "InvalidSignature";
    ErrorReason["Expired"] = "Expired";
    ErrorReason["NonceUsed"] = "NonceUsed";
    ErrorReason["InsufficientBalance"] = "InsufficientBalance";
    ErrorReason["InsufficientPaymentAmount"] = "InsufficientPaymentAmount";
    ErrorReason["UntrustedDelegate"] = "UntrustedDelegate";
    ErrorReason["InvalidPayload"] = "InvalidPayload";
    ErrorReason["ChainIdMismatch"] = "ChainIdMismatch";
    ErrorReason["RecipientMismatch"] = "RecipientMismatch";
    ErrorReason["AssetMismatch"] = "AssetMismatch";
    ErrorReason["AcceptedRequirementsMismatch"] = "AcceptedRequirementsMismatch";
    ErrorReason["TransactionSimulationFailed"] = "TransactionSimulationFailed";
    ErrorReason["TransactionReverted"] = "TransactionReverted";
})(ErrorReason || (ErrorReason = {}));
