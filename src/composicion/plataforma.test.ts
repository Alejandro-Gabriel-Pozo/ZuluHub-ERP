import { describe, expect, it, vi } from "vitest";
import { ErrorDeEntorno, type FuenteDeEntorno } from "./entorno";
import { armarPlataforma } from "./plataforma";

/**
 * La puerta de plataforma es perezosa como la de la web (P-12): armarla no lee ni valida nada, cada pieza
 * pide SUS variables recién al usarse, y una variable que falta falla cerrado nombrando solo el NOMBRE.
 * (Con la base real se prueba en `test/integracion/ejecutar-caso-de-plataforma.test.ts`.)
 */

const VALIDA: FuenteDeEntorno = {
  PEDERNAL_DB_PLATAFORMA: "postgres://usuario:contrasena@127.0.0.1:1/base",
  PEDERNAL_CLAVE_CONTEXTO: `1:${"ab".repeat(32)}`,
  PEDERNAL_SECRETO_INVITACIONES: "cd".repeat(32),
};

const AHORA = new Date("2026-10-20T12:00:00Z");

describe("armarPlataforma", () => {
  it("armarla no lee el entorno ni abre ninguna conexión; cada grupo lo valida al pedirlo", () => {
    const fuente = vi.fn(() => VALIDA);
    const plataforma = armarPlataforma({ fuente });
    expect(fuente).not.toHaveBeenCalled();
    plataforma.casosDeUsoDeDominios();
    expect(fuente).toHaveBeenCalled();
  });

  it("cada grupo es una sola instancia", () => {
    const plataforma = armarPlataforma({ fuente: () => VALIDA });
    expect(plataforma.casosDeUsoDeAltas()).toBe(plataforma.casosDeUsoDeAltas());
    expect(plataforma.consultasDePlataforma()).toBe(plataforma.consultasDePlataforma());
  });

  it("ofrece los casos que el entorno de la web nunca tuvo: alta, marcas y planes, dominios y soporte", () => {
    const plataforma = armarPlataforma({ fuente: () => VALIDA });
    expect(Object.keys(plataforma.casosDeUsoDeAltas())).toEqual(
      expect.arrayContaining([
        "altaDeEmpresa",
        "cancelarAlta",
        "suspenderTenant",
        "suspenderPersona",
      ]),
    );
    expect(Object.keys(plataforma.casosDeUsoDeMarcasYPlanes())).toEqual(
      expect.arrayContaining(["crearMarca", "crearPlan", "asignarPlan", "activarModuloDeEmpresa"]),
    );
    expect(Object.keys(plataforma.casosDeUsoDeDominios())).toContain("agregarDominio");
    expect(Object.keys(plataforma.casosDeUsoDeSoporte())).toEqual(
      expect.arrayContaining(["explicarPorQue", "registrarReferenciaDeError"]),
    );
    expect(Object.keys(plataforma.consultasDePlataforma())).toEqual(
      expect.arrayContaining(["listarTenants", "listarEmpresas", "catalogoDePerillas"]),
    );
    expect(Object.keys(plataforma.consultasDeMarcasYPlanes())).toEqual(
      expect.arrayContaining([
        "listarPlanes",
        "fichaDeMarca",
        "marcasParaElAlta",
        "catalogosDeMarca",
        "tenantsConLaVersion",
      ]),
    );
  });

  it("sin la cadena ni la clave, falla cerrado con un error de entorno genérico y registra solo los nombres", async () => {
    const registrar = vi.fn();
    const plataforma = armarPlataforma({ fuente: () => ({}), registrar });
    const falla = await plataforma.buscarAdmin("a@b.test", AHORA).catch((e: unknown) => e);
    expect(falla).toBeInstanceOf(ErrorDeEntorno);
    expect((falla as Error).message).toBe("el entorno del servidor no está bien configurado");
    expect(registrar).toHaveBeenCalledWith(
      "pieza transacciones-de-plataforma: PEDERNAL_DB_PLATAFORMA falta; PEDERNAL_CLAVE_CONTEXTO falta",
    );
  });

  it("una clave de contexto mal formada falla cerrado sin repetirla", async () => {
    const registrar = vi.fn();
    const plataforma = armarPlataforma({
      fuente: () => ({ ...VALIDA, PEDERNAL_CLAVE_CONTEXTO: "sin-forma-valida" }),
      registrar,
    });
    const falla = await plataforma.buscarAdmin("a@b.test", AHORA).catch((e: unknown) => e);
    expect(falla).toBeInstanceOf(ErrorDeEntorno);
    expect(JSON.stringify(registrar.mock.calls)).not.toContain("sin-forma-valida");
  });

  it("el alta pide además el secreto de invitaciones; los demás grupos no lo necesitan", () => {
    const sinSecreto = () => ({
      PEDERNAL_DB_PLATAFORMA: VALIDA["PEDERNAL_DB_PLATAFORMA"],
      PEDERNAL_CLAVE_CONTEXTO: VALIDA["PEDERNAL_CLAVE_CONTEXTO"],
    });
    const registrar = vi.fn();
    expect(() => armarPlataforma({ fuente: sinSecreto, registrar }).casosDeUsoDeAltas()).toThrow(
      ErrorDeEntorno,
    );
    expect(registrar).toHaveBeenCalledWith(
      "pieza tokens-de-plataforma: PEDERNAL_SECRETO_INVITACIONES falta",
    );
    const plataforma = armarPlataforma({ fuente: sinSecreto });
    expect(() => plataforma.casosDeUsoDeMarcasYPlanes()).not.toThrow();
    expect(() => plataforma.casosDeUsoDeDominios()).not.toThrow();
  });

  it("una variable prohibida en el entorno impide armar cualquier pieza", async () => {
    const plataforma = armarPlataforma({ fuente: () => ({ ...VALIDA, DATABASE_URL: "x" }) });
    await expect(plataforma.buscarAdmin("a@b.test", AHORA)).rejects.toBeInstanceOf(ErrorDeEntorno);
  });

  it("cerrar sin haber abierto nada no pide el entorno ni falla", async () => {
    const fuente = vi.fn(() => ({}));
    const plataforma = armarPlataforma({ fuente });
    await expect(plataforma.cerrar()).resolves.toBeUndefined();
    expect(fuente).not.toHaveBeenCalled();
  });
});
