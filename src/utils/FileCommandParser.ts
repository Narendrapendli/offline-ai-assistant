

export type CommandType = 'write' | 'read' | 'fix' | 'analyze' | 'run' | 'review' | 'optimize' | 'none';

export interface FileCommand {
    type: CommandType;
    filename: string;
    instruction: string;
}

export class FileCommandParser {
    public static parse(message: string): FileCommand | null {
        const msg = message.trim();

        const patterns = [
            // Fix/Debug: Catch "fix errors in day2.py", "fix day2.py", "find errors in day2.py", etc.
            { type: 'fix' as CommandType, regex: /(?:fix\s+(?:all\s+)?(?:errors?|bugs?|issues?|file)?\s+(?:in\s+)?|find\s+errors?\s+in\s+|debug\s+|what(?:\s+is|\s+'?s)\s+wrong\s+with\s+)['"]?([\w\.\-\d/]+\.[\w\+\d]+)['"]?/i },
            
            // Review: Catch "review x.py"
            { type: 'review' as CommandType, regex: /(?:review|peer\s+review)\s+['"]?([\w\.\-\d/]+\.[\w\+\d]+)['"]?/i },

            // Optimize: Catch "optimize x.py", "make x.py faster"
            { type: 'optimize' as CommandType, regex: /(?:optimize|make\s+.*?faster|improve\s+performance\s+of)\s+['"]?([\w\.\-\d/]+\.[\w\+\d]+)['"]?/i },

            // Write/Add commands
            { type: 'write' as CommandType, regex: /(?:write|add|insert|save).*?\s(?:in|to|into|file|filename|file\s+name)\s+['"]?([\w\.\-\d/]+\.[\w\+\d]+)['"]?(?:\s+file)?/i },
            
            // Analyze/Explain commands
            { type: 'analyze' as CommandType, regex: /(?:explain|analyze|what\s+does)\s+['"]?([\w\.\-\d/]+\.[\w\+\d]+)['"]?(?:\s+do)?/i },
            
            // Run commands
            { type: 'run' as CommandType, regex: /(?:run|execute)\s+['"]?([\w\.\-\d/]+\.[\w\+\d]+)['"]?/i },

            // Read command
            { type: 'read' as CommandType, regex: /(?:read|show|get)\s+['"]?([\w\.\-\d/]+\.[\w\+\d]+)['"]?/i }
        ];

        for (const p of patterns) {
            const match = msg.match(p.regex);
            if (match && match[1]) {
                return {
                    type: p.type,
                    filename: match[1],
                    instruction: msg
                };
            }
        }

        return null;
    }
}
