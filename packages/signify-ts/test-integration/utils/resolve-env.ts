export interface TestEnvironment {
    url: string;
    bootUrl: string;
    vleiServerUrl: string;
    witnessUrls: string[];
    witnessIds: string[];
}

const WAN = 'BBilc4-L3tFUnfM_wJr4S4OJanAv_VmF_dJNN6vkf2Ha';
const WIL = 'BLskRTInXnMxWaGqcpSyMgo0nYbalW99cGZESrz3zapM';
const WES = 'BIKKuvBwpmDVA4Ds-EpL5bt9OqPzWPja2LigFYZN2YfX';

export function resolveEnvironment(
    env: Record<string, string | undefined> = process.env
): TestEnvironment {
    const url = 'http://127.0.0.1:3901';
    const bootUrl = 'http://127.0.0.1:3903';
    const vleiServerHostname = env.VLEI_SERVER_HOSTNAME ?? 'localhost';
    const witnessDemoHostname = env.WITNESS_DEMO_HOSTNAME ?? 'localhost';

    return {
        url,
        bootUrl,
        witnessUrls: [
            `http://${witnessDemoHostname}:5642`,
            `http://${witnessDemoHostname}:5643`,
            `http://${witnessDemoHostname}:5644`,
        ],
        witnessIds: [WAN, WIL, WES],
        vleiServerUrl: `http://${vleiServerHostname}:7723`,
    };
}
