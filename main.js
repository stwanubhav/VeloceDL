const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync, spawn } = require("child_process");

const TUNNEL_NAME = "YTdownload";
const HOSTNAME = "ytdownload.qzz.io";
const APP_PORT = 11817;

const SETUP_FLAG = ".cloudflare_setup_complete";

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function run(cmd) {
    console.log(`Running: ${cmd}`);

    try {
        return execSync(cmd, {
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"]
        });
    } catch (err) {
        console.error(err.stderr?.toString() || err.message);
        return err.stdout?.toString() || "";
    }
}

function runInteractive(command, args = []) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, {
            stdio: "inherit"
        });

        proc.on("close", code => {
            if (code === 0) {
                resolve();
            } else {
                reject(
                    new Error(
                        `${command} exited with code ${code}`
                    )
                );
            }
        });

        proc.on("error", reject);
    });
}

async function installCloudflared() {
    if (fs.existsSync("./cloudflared")) {
        console.log("cloudflared already exists");
        return;
    }

    console.log("Downloading cloudflared...");

    execSync(
        "curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared",
        { stdio: "inherit" }
    );

    execSync("chmod +x cloudflared", {
        stdio: "inherit"
    });

    console.log("cloudflared installed");
}

async function loginIfNeeded() {
    const cloudDir = path.join(
        os.homedir(),
        ".cloudflared"
    );

    const certFile = path.join(
        cloudDir,
        "cert.pem"
    );

    if (fs.existsSync(certFile)) {
        console.log("Already logged in");
        return;
    }

    console.log("\nCloudflare login required.");
    console.log(
        "Complete authentication in the browser."
    );
    console.log(
        "Waiting until login is completed...\n"
    );

    await runInteractive("./cloudflared", [
        "tunnel",
        "login"
    ]);

    if (!fs.existsSync(certFile)) {
        throw new Error(
            "Login completed but cert.pem was not found."
        );
    }

    console.log("Cloudflare login successful");
}

async function createTunnelIfNeeded() {
    const tunnels = run(
        "./cloudflared tunnel list"
    );

    if (tunnels.includes(TUNNEL_NAME)) {
        console.log(
            `Tunnel "${TUNNEL_NAME}" already exists`
        );
        return;
    }

    console.log(
        `Creating tunnel "${TUNNEL_NAME}"...`
    );

    await runInteractive("./cloudflared", [
        "tunnel",
        "create",
        TUNNEL_NAME
    ]);
}

function getTunnelId() {
    const cloudDir = path.join(
        os.homedir(),
        ".cloudflared"
    );

    const files = fs.readdirSync(cloudDir);

    for (const file of files) {
        if (file.endsWith(".json")) {
            return file.replace(".json", "");
        }
    }

    throw new Error(
        "Tunnel credentials JSON not found"
    );
}

function createConfig(tunnelId) {
    const cloudDir = path.join(
        os.homedir(),
        ".cloudflared"
    );

    const config = `tunnel: ${tunnelId}
credentials-file: ${cloudDir}/${tunnelId}.json

ingress:
  - hostname: ${HOSTNAME}
    service: http://localhost:${APP_PORT}

  - service: http_status:404
`;

    fs.writeFileSync(
        path.join(cloudDir, "config.yml"),
        config
    );

    console.log("Config created");
}

async function createDNS() {
    console.log("Creating DNS route...");

    await runInteractive("./cloudflared", [
        "tunnel",
        "route",
        "dns",
        TUNNEL_NAME,
        HOSTNAME
    ]);
}

function startTunnel() {
    console.log("Starting tunnel...");

    const proc = spawn(
        "./cloudflared",
        ["tunnel", "run", TUNNEL_NAME],
        {
            detached: true,
            stdio: "ignore"
        }
    );

    proc.unref();
}

function startApp() {
    console.log("Starting start.js...");

    const proc = spawn(
        "node",
        ["start.js"],
        {
            detached: false,
            stdio: "inherit"
        }
    );

    proc.on("exit", code => {
        console.log(
            `start.js exited with code ${code}`
        );
        process.exit(code || 0);
    });
}

async function setup() {
    await installCloudflared();

    if (!fs.existsSync(SETUP_FLAG)) {
        await loginIfNeeded();

        await createTunnelIfNeeded();

        const tunnelId = getTunnelId();

        createConfig(tunnelId);

        await createDNS();

        fs.writeFileSync(
            SETUP_FLAG,
            "done"
        );

        console.log(
            "Initial setup completed"
        );
    } else {
        console.log(
            "Setup already completed"
        );
    }
}

async function main() {
    try {
        await setup();

        startTunnel();

        console.log(
            "Waiting 5 seconds for tunnel..."
        );

        await sleep(5000);

        startApp();
    } catch (err) {
        console.error(
            "\nError:",
            err.message
        );
        process.exit(1);
    }
}

main();
