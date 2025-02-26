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

    static execute(command: string) {
        execSync(command, { cwd: process.cwd() });
    }
    static executeCommand(command: string) {
        if (!utils.verbose) {
            command = `${command} > /dev/null 2 >& 1`;
        }
        execSync(command, { cwd: process.cwd() });
    }

    static executeCommandSucceeds(command: string) {
        if (!utils.verbose) {
            command = `${command} > /dev/null 2 >& 1`;
        }
        try {
            return (execSync(`${command} && echo 1`, { cwd: process.cwd() })?.toString().trim() === '1');
        } catch (e) {
            return false;
        }
    }

    static executeCommandWithOutput(command: string) {
        return execSync(`${command} `).toString().trim();
    }
}