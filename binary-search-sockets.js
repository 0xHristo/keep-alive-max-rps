const https = require('https')
const superagent = require('superagent')
const inspector = require('inspector')
const fs = require('fs')

const HOST = 'betinia.com'
const PORT = 443
const PATH = '/ping.json'
const PROFILERS_REPORTS_PATH = './profilers-reports'
const URL = `https://${HOST}${PATH}`
const REPORT_CONFIG_FILE_NAME = 'report-config.json'
const REPORT_DATASET_FILE_NAME = 'dataset.csv'
const TOTAL_REQUESSTS = 1000  // 10k requests

const session = new inspector.Session()
session.connect()

const getReportName = (sockets, rps) => `sockets=${sockets}-rps=${Math.floor(rps)}.cpuprofile`
const getReportFolder = () => `${PROFILERS_REPORTS_PATH}/${Date.now()}-${HOST}`

const saveReport = (reportName, profile) => {
    fs.writeFileSync(reportName, JSON.stringify(profile))
}

async function startCPUProfile() {
    await new Promise((resolve, reject) => {
        session.post('Profiler.enable', (err) => {
            if (err) return reject(err);
            session.post('Profiler.start', (err) => {
                if (err) return reject(err);
                console.log('CPU profiling started.');
                resolve();
            });
        });
    });
}

async function stopCPUProfile(maxSockets, rps, reportFolder) {
    const profile = await new Promise((resolve, reject) => {
        session.post('Profiler.stop', (err, result) => {
            if (err) return reject(err);
            resolve(result.profile);
        });
    });

    // Save the profile to a file
    const cpuReportName = getReportName(maxSockets, rps)
    const cpuReportPath = `${reportFolder}/${cpuReportName}`
    fs.writeFileSync(cpuReportPath, JSON.stringify(profile));
    console.log(`CPU profile saved as ${cpuReportPath}`);
}

const sendRequest = async (agent) => {
    await new Promise((resolve) => setTimeout(resolve, 30))

    return superagent.get(URL).agent(agent)
}

const dataPoints = ['sockets,rps,requests']

const tryWithSockets = async (maxSockets, reportFolder) => {
    console.log(`Trying with ${maxSockets} sockets`)
    const agent = new https.Agent({ maxSockets })
    const requests = []
    const start = Date.now()
    await startCPUProfile()
    for (let i = 0; i < TOTAL_REQUESSTS; i++) {
        requests.push(sendRequest(agent))
    }

    await Promise.allSettled(requests)

    const end = Date.now()
    const rps = TOTAL_REQUESSTS / ((end - start) / 1000)
    
    await stopCPUProfile(maxSockets, rps, reportFolder)
    console.log(`RPS: ${rps}`)
    fs.appendFileSync(`${reportFolder}/${REPORT_DATASET_FILE_NAME}`, `${maxSockets},${rps},${TOTAL_REQUESSTS}\n`)
    return rps
}

const initializeNewRport = () => {
    const reportFolder = getReportFolder()
    fs.mkdirSync(reportFolder)
    fs.writeFileSync(`${reportFolder}/${REPORT_CONFIG_FILE_NAME}`, JSON.stringify({
        host: HOST,
        port: PORT,
        path: PATH,
        url: URL,
        totalRequests: TOTAL_REQUESSTS,
        date: new Date().toISOString
    }))
    fs.writeFileSync(`${reportFolder}/${REPORT_DATASET_FILE_NAME}`, 'sockets,rps,requests\n')
    return reportFolder
}

let l = 1, r = 1000
const dp = {}
const findOptimalSockets = async () => {
    const reportFolder = initializeNewRport()
    while (l < r) {
        const midPoint = Math.floor((l + r) / 2)
        const leftMidPoint = Math.floor((l + midPoint) / 2)
        const rightMidPoint = Math.floor((midPoint + r) / 2)

        const leftMidPointRPS = dp[leftMidPoint] ? dp[leftMidPoint] : dp[leftMidPoint] = await tryWithSockets(leftMidPoint, reportFolder)
        const rightMidPointRPS = dp[rightMidPoint] ? dp[rightMidPoint] : dp[rightMidPoint] = await tryWithSockets(rightMidPoint, reportFolder)
        const midRPS = dp[midPoint] ? dp[midPoint] : dp[midPoint] = await tryWithSockets(midPoint, reportFolder)

        /**
            Mid < Left < Right => l = mid + 1, r = r
            Mid < Right < Left => l = l, r= mid - 1
            Left < Mid < Right => l = mid + 1, r = r
            Left < Right < Mid => l = leftMid + 1, r = rightMid - 1
            Right < Mid < Left => l = l, r = mid - 1
            Right < Left < Mid => l = leftMid + 1, r = rightMid - 1
         */
        if ((midRPS < leftMidPointRPS && leftMidPointRPS < rightMidPointRPS) || (leftMidPointRPS < midRPS && midRPS < rightMidPointRPS)) {
            l = midPoint + 1
        } else if ((midRPS < rightMidPointRPS && rightMidPointRPS < leftMidPointRPS) || (rightMidPointRPS < midRPS && midRPS < leftMidPointRPS)) {
            r = midPoint - 1
        } else {
            l = leftMidPoint + 1
            r = rightMidPoint - 1
        }

        await new Promise((resolve) => setTimeout(resolve, 5000))
    }
}

findOptimalSockets()
