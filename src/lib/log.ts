export function sanitizeErrorForLog(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }

  if (typeof error === "string") {
    return error;
  }

  return String(error);
}

export function secureLogError(context: string, error: unknown) {
  console.error(`[KPassword] ${context}`, sanitizeErrorForLog(error));
}
