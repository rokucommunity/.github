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

    static log(message: string) {
        const logger = this.getInstance();
        console.log(`${logger.indentChar.repeat(logger.indentLevel)}${message}`);
    }

    static increaseIndent() {
        this.getInstance().indentLevel += 4;
    }

    static decreaseIndent() {
        this.getInstance().indentLevel -= 4;
    }
}

export class utils {
    static executeCommand(command: string) {
        execSync(`${command} > /dev/null 2>&1 `, { cwd: process.cwd() });
    }

    static executeCommandSucceeds(command: string) {
        try {
            return (execSync(`${command} > /dev/null 2>&1 && echo 1`, { cwd: process.cwd() })?.toString().trim() === '1');
        } catch (e) {
            return false;
        }
    }

    static executeCommandWithOutput(command: string) {
        return execSync(`${command}`).toString().trim();
    }
}