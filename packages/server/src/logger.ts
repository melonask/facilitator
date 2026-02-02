export const log = {
  info(msg: string, data?: Record<string, unknown>) {
    console.log(
      JSON.stringify({
        level: "info",
        msg,
        ...data,
        ts: new Date().toISOString(),
      }),
    );
  },
  error(msg: string, data?: Record<string, unknown>) {
    console.error(
      JSON.stringify({
        level: "error",
        msg,
        ...data,
        ts: new Date().toISOString(),
      }),
    );
  },
};
