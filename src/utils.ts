import { execSync } from 'child_process';

export class logger {
    private static instance: logger;
    private indentLevel = 0;
    private indentChar = '.';

    private constructor() { }

    static getInstance() {
        if (!logger.instance) {
            logger.instance = new logger();
        }
        return logger.instance;
    }

    static inLog(...messages: any[]) {
        const logger = this.getInstance();
        logger.indentLevel += 4;
        console.log(`${logger.indentChar.repeat(logger.indentLevel)}`, ...messages);
        logger.indentLevel -= 4;
    }

    static log(...messages: any[]) {
        const logger = this.getInstance();
        console.log(`${logger.indentChar.repeat(logger.indentLevel)}`, ...messages);
    }

    static increaseIndent() {
        this.getInstance().indentLevel += 4;
    }

    static decreaseIndent() {
        this.getInstance().indentLevel -= 4;
    }
}

export class utils {
    static verbose = true;
    static OCTOKIT_PER_PAGE = 100;

    static executeCommand(command: string, options?: { cwd: string }) {
        options ??= { cwd: process.cwd() };

        if (!utils.verbose) {
            command = `${command} > /dev/null 2>&1`;
        }
        //logger.inLog(`Executing ${command}`);
        execSync(command, options);
    }

    static executeCommandSucceeds(command: string, options?: { cwd: string }) {
        options ??= { cwd: process.cwd() };

        if (!utils.verbose) {
            command = `${command} > /dev/null 2>&1`;
        }
        try {
            //logger.inLog(`Executing ${command}`);
            return (execSync(`${command} && echo 1`, options)?.toString().trim() === '1');
        } catch (e) {
            return false;
        }
    }

    static executeCommandWithOutput(command: string, options?: { cwd: string }) {
        options ??= { cwd: process.cwd() };

        //logger.inLog(`Executing ${command}`);
        return execSync(`${command} `, options).toString().trim();
    }

    static async octokitPageHelper<T>(api: (options: any, page: number) => Promise<{ data: T[] }>, options = {}): Promise<T[]> {
        let getMorePages = true;
        let page = 1;
        let data: T[] = [];

        while (getMorePages) {
            let releasePage = await api(options, page);
            if (!releasePage.data) {
                break;
            }
            if (releasePage.data.length < utils.OCTOKIT_PER_PAGE) {
                getMorePages = false;
            }
            data = data.concat(releasePage.data);
            page++;
        }
        return data;
    }
}