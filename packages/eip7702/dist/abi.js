export const ERC20_ABI = [
    {
        name: "balanceOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    },
];
export const DELEGATE_ABI = [
    {
        name: "transfer",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            {
                name: "intent",
                type: "tuple",
                components: [
                    { name: "token", type: "address" },
                    { name: "amount", type: "uint256" },
                    { name: "to", type: "address" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                ],
            },
            { name: "signature", type: "bytes" },
        ],
        outputs: [],
    },
    {
        name: "transferEth",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            {
                name: "intent",
                type: "tuple",
                components: [
                    { name: "amount", type: "uint256" },
                    { name: "to", type: "address" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                ],
            },
            { name: "signature", type: "bytes" },
        ],
        outputs: [],
    },
];
