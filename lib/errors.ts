/** Thrown when an HTTP request failed due to an authorization
 * issue. Perform a signing-in first.
 */
export class UnauthorizedError extends Error {
    constructor(msg?: string) {
        super(msg || "Unauthorized");
        Object.setPrototypeOf(this, UnauthorizedError.prototype);
    }
}
