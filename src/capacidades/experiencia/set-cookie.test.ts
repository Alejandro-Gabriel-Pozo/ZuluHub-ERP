import { describe, expect, it } from "vitest";
import { cookieParaNext } from "./set-cookie";

describe("cookieParaNext", () => {
  it("la cookie de sesión de la librería: nombre, valor decodificado una vez y todos sus atributos", () => {
    const c = cookieParaNext(
      "__Secure-zh_emp.session_token=abc.def%2Bghi%3D; Max-Age=900; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    expect(c).toEqual({
      nombre: "__Secure-zh_emp.session_token",
      valor: "abc.def+ghi=",
      maxAge: 900,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });
  });

  it("los atributos no distinguen mayúsculas", () => {
    expect(cookieParaNext("a=b; MAX-AGE=5; path=/x; httponly; SECURE; samesite=STRICT")).toEqual({
      nombre: "a",
      valor: "b",
      maxAge: 5,
      path: "/x",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
    });
    expect(cookieParaNext("a=b; SameSite=None")?.sameSite).toBe("none");
  });

  it("borrar: Max-Age 0 o negativo y valor vacío", () => {
    expect(cookieParaNext("a=; Max-Age=0; Path=/")).toEqual({
      nombre: "a",
      valor: "",
      maxAge: 0,
      path: "/",
    });
    expect(cookieParaNext("a=x; Max-Age=-1")?.maxAge).toBe(-1);
  });

  it("Expires y Domain", () => {
    const c = cookieParaNext("a=b; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Domain=app.test");
    expect(c?.expires?.toISOString()).toBe("2026-10-21T07:28:00.000Z");
    expect(c?.domain).toBe("app.test");
  });

  it("un valor con signo igual adentro se conserva entero", () => {
    expect(cookieParaNext("a=b=c==")?.valor).toBe("b=c==");
  });

  it("un valor con una codificación rota se deja como llegó", () => {
    expect(cookieParaNext("a=%E0%A4%A")?.valor).toBe("%E0%A4%A");
  });

  it("atributos inválidos o desconocidos se ignoran", () => {
    expect(
      cookieParaNext(
        "a=b; Max-Age=mucho; Expires=ayer; SameSite=Rara; Path=; Domain=; Priority=High",
      ),
    ).toEqual({ nombre: "a", valor: "b" });
  });

  it("sin nombre válido no es una cookie", () => {
    for (const crudo of ["", "sin igual", "=valor", " =x", "a b=c", "a;b=c", "(a)=c"]) {
      expect(cookieParaNext(crudo), crudo).toBeNull();
    }
  });

  it("los espacios alrededor del nombre y del valor se recortan", () => {
    expect(cookieParaNext(" a = b ; Path=/")).toEqual({ nombre: "a", valor: "b", path: "/" });
  });
});
