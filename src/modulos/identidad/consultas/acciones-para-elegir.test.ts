import { describe, expect, it } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { armarAccionesParaElegir } from "./acciones-para-elegir";
import type { DependenciasDeConsultasDeIdentidad, TxDeConsultasDeIdentidad } from "./contrato";

const contexto = {
  tipo: "OPERATIVO",
  empresaId: "e-1",
  personaId: "p-1",
  marcaDeEntrada: null,
  ahora: new Date("2026-11-26T12:00:00Z"),
} as unknown as ContextoOperativo;

/** Una transacción mínima: el actor con el rol dado, los pisos y los módulos del plan que se le pasan. */
function dependencias(
  rol: "GERENTE" | "OPERADOR",
  pisos: Record<string, "SOLO_GERENTE" | "TODOS_LOS_ROLES">,
  modulos: string[],
): DependenciasDeConsultasDeIdentidad {
  const tx = {
    autorizacion: {
      delActor: () =>
        Promise.resolve({
          rol,
          modulosActivados: [],
          modulosHabilitados: modulos,
          acciones: rol === "GERENTE" ? undefined : [],
        }),
    },
    roles: { pisos: () => Promise.resolve(pisos) },
    derechos: { deLaEmpresa: () => Promise.resolve({ modulosHabilitados: new Set(modulos) }) },
  } as unknown as TxDeConsultasDeIdentidad;
  return {
    reglas: REGLAS_DE_EMPRESA,
    transacciones: { ejecutar: (_o: unknown, trabajo: (t: typeof tx) => unknown) => trabajo(tx) },
  } as unknown as DependenciasDeConsultasDeIdentidad;
}

describe("accionesParaElegir", () => {
  it("agrupa todo el catálogo por módulo, marca el piso de cada acción y qué módulos no están en el plan", async () => {
    const consulta = armarAccionesParaElegir(
      dependencias(
        "GERENTE",
        { "roles.ver": "SOLO_GERENTE", "permisos.ver_propios": "TODOS_LOS_ROLES" },
        ["administracion"],
      ),
    );
    const r = await consulta(contexto);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const porModulo = new Map(r.valor.map((m) => [m.modulo, m]));
    expect(porModulo.get("administracion")?.enElPlan).toBe(true);
    expect(porModulo.get("stock")?.enElPlan).toBe(false);
    const admin = porModulo.get("administracion")?.acciones ?? [];
    expect(admin.find((a) => a.accion === "roles.ver")?.piso).toBe("SOLO_GERENTE");
    expect(admin.find((a) => a.accion === "permisos.ver_propios")?.piso).toBe("TODOS_LOS_ROLES");
    expect(admin.find((a) => a.accion === "usuarios.invitar")?.piso).toBeNull();
    expect(r.valor.map((m) => m.modulo)).toEqual([...r.valor.map((m) => m.modulo)].sort());
  });

  it("quien no es el gerente no ve las casillas: SIN_PERMISO y no lee nada más", async () => {
    const consulta = armarAccionesParaElegir(dependencias("OPERADOR", {}, ["administracion"]));
    expect(await consulta(contexto)).toEqual({ ok: false, error: "SIN_PERMISO" });
  });
});
