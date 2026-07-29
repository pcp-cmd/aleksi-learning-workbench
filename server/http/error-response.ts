export type HttpErrorRecovery =
  | {
      action: "reduce_payload";
      target: "request_body" | "reading_material";
      maxBytes: number;
    }
  | {
      action: "correct_fields";
      fields: Array<{
        path: string;
        message: string;
      }>;
    };

export type HttpErrorBody = {
  error: {
    code: string;
    message: string;
    recovery?: HttpErrorRecovery;
    transactionId?: string;
  };
};

export type HttpErrorResponse = {
  status: number;
  body: HttpErrorBody;
};

export function httpErrorResponse(
  status: number,
  code: string,
  message: string,
  recovery?: HttpErrorRecovery,
  details?: Readonly<{ transactionId?: string }>
): HttpErrorResponse {
  return {
    status,
    body: {
      error: {
        code,
        message,
        ...(recovery === undefined ? {} : { recovery }),
        ...(details?.transactionId === undefined
          ? {}
          : { transactionId: details.transactionId })
      }
    }
  };
}
