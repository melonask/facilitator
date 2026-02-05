export interface NonceManager {
  checkAndMark(nonce: string): boolean;
  has(nonce: string): boolean;
}
