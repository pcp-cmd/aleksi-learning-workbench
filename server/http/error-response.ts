export type HttpErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export type HttpErrorResponse = {
  status: number;
  body: HttpErrorBody;
};

export function httpErrorResponse(
  status: number,
  code: string,
  message: string
): HttpErrorResponse {
  return {
    status,
    body: {
      error: {
        code,
        message
      }
    }
  };
}
