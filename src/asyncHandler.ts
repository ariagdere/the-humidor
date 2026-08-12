import { Request, Response, NextFunction, RequestHandler } from "express";

// Express varsayılan olarak async handler'larda fırlatılan hataları yakalamaz.
// Her route'u tek tek try/catch yazmak yerine bu sarmalayıcıyı kullanıyoruz.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
