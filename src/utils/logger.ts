type LogLevel = 'info' | 'warn' | 'error' | 'debug';

class Logger {
  private formatMessage(level: LogLevel, message: string, context?: Record<string, any>) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      ...(context && { context }),
    };
    return JSON.stringify(logEntry);
  }

  info(message: string, context?: Record<string, any>) {
    console.log(this.formatMessage('info', message, context));
  }

  warn(message: string, context?: Record<string, any>) {
    console.warn(this.formatMessage('warn', message, context));
  }

  error(message: string, context?: Record<string, any>) {
    console.error(this.formatMessage('error', message, context));
  }

  debug(message: string, context?: Record<string, any>) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(this.formatMessage('debug', message, context));
    }
  }
}

export const logger = new Logger();
