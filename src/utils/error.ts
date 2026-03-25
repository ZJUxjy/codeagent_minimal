/**
 * Normalize unknown thrown values into readable error messages.
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message
    }

    if (typeof error === "string") {
        return error
    }

    if (error && typeof error === "object") {
        if ("message" in error && typeof error.message === "string") {
            return error.message
        }

        try {
            return JSON.stringify(error)
        } catch {
            // fall through to default
        }
    }

    return "Unknown error"
}
