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

    static executeCommand(command: string, options?: { cwd: string }) {
        if (!options.cwd) {
            options.cwd = process.cwd();
        }
        if (!utils.verbose) {
            command = `${command} > /dev/null 2>& 1`;
        }
        logger.inLog(`Executing ${command}`);
        execSync(command, options);
    }

    static executeCommandSucceeds(command: string, options?: { cwd: string }) {
        if (!options.cwd) {
            options.cwd = process.cwd();
        }

        if (!utils.verbose) {
            command = `${command} > /dev/null 2>& 1`;
        }
        try {
            logger.inLog(`Executing ${command}`);
            return (execSync(`${command} && echo 1`, options)?.toString().trim() === '1');
        } catch (e) {
            return false;
        }
    }

    static executeCommandWithOutput(command: string, options?: { cwd: string }) {
        if (!options.cwd) {
            options.cwd = process.cwd();
        }
        logger.inLog(`Executing ${command}`);
        return execSync(`${command} `, options).toString().trim();
    }
}