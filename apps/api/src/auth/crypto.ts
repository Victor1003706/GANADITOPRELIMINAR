import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

/**
 * Genera el hash de una contraseña usando bcryptjs.
 */
export async function hashPassword(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, SALT_ROUNDS);
}

/**
 * Compara una contraseña en texto plano contra su hash almacenado.
 */
export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainText, hash);
}
