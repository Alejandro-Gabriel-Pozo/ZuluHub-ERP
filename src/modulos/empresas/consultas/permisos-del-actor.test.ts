import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../../capacidades/modulos/catalogo";
import {
  PERMISOS_DE_EMPRESA,
  REGLAS_DE_EMPRESA,
  type ReglasDeEmpresa,
} from "../../../capacidades/permisos/empresa";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import { ROLES_DE_EMPRESA } from "../../../capacidades/permisos/roles";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../../../test/utilidades/marcas";
import { empresaId, personaId } from "../../../primitivas/identificadores/marca";
import type { DatosDelActor } from "../../../puertos/autorizacion";
import type { OpcionesDeTransaccion, Transacciones } from "../../../puertos/transacciones";
import { crearConsultasDeEmpresas } from "./consultas";
import type { TxDeConsultasDeEmpresas } from "./contrato";

/**
 * `permisosDelActor`: qué puede hacer HOY la persona, con el módulo y el rol que el servidor lee en la transacción. Sin base de datos:
 * la transacción es en memoria y solo responde `autorizacion` (la consulta no toca nada más).
 */

const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date(0),
};

const CON_FACTURACION: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    facturacion: { ...CATALOGO_DE_MODULOS.facturacion, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

function armar(actor: () => DatosDelActor, reglas: ReglasDeEmpresa = REGLAS_DE_EMPRESA) {
  const aperturas: OpcionesDeTransaccion[] = [];
  let lecturasDelActor = 0;
  const tx = {
    autorizacion: {
      delActor: () => {
        lecturasDelActor += 1;
        return Promise.resolve(actor());
      },
      sucursalesDelActor: () => Promise.reject(new Error("no mira las sucursales")),
    },
  } as unknown as TxDeConsultasDeEmpresas;
  const transacciones: Transacciones<TxDeConsultasDeEmpresas> = {
    ejecutar: (opciones, trabajo) => {
      aperturas.push(opciones);
      return trabajo(tx);
    },
  };
  return {
    consultas: crearConsultasDeEmpresas({ transacciones, reglas }),
    aperturas,
    lecturasDelActor: () => lecturasDelActor,
  };
}

const exito = <T>(r: { ok: true; valor: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`se esperaba éxito y fue ${String(r.error)}`);
  return r.valor;
};

const conFacturacionEnElPlan = (rol: DatosDelActor["rol"]): DatosDelActor => ({
  rol,
  modulosActivados: ["facturacion"],
  modulosHabilitados: ["facturacion"],
});

describe("permisosDelActor", () => {
  it("los tres roles la pueden pedir y ven si pueden mirar los comprobantes (comprobantes.ver)", async () => {
    for (const rol of ROLES_DE_EMPRESA) {
      const { consultas } = armar(() => conFacturacionEnElPlan(rol), CON_FACTURACION);
      const permisos = exito(await consultas.permisosDelActor(contexto));
      expect(permisos.acciones, rol).toContain("comprobantes.ver");
      expect(permisos.acciones, rol).toContain("permisos.ver_propios");
    }
  });

  it("el rol manda: el operador no recibe lo que es del gerente, y el gerente sí", async () => {
    const operador = exito(
      await armar(
        () => conFacturacionEnElPlan("OPERADOR"),
        CON_FACTURACION,
      ).consultas.permisosDelActor(contexto),
    );
    const gerente = exito(
      await armar(
        () => conFacturacionEnElPlan("GERENTE"),
        CON_FACTURACION,
      ).consultas.permisosDelActor(contexto),
    );
    for (const soloDelGerente of ["certificados.gestionar", "series.resincronizar"] as const) {
      expect(operador.acciones).not.toContain(soloDelGerente);
      expect(gerente.acciones).toContain(soloDelGerente);
    }
  });

  it("el módulo manda: con facturación en desarrollo (el catálogo real) nadie ve comprobantes.ver aunque el rol alcance", async () => {
    const { consultas } = armar(() => conFacturacionEnElPlan("GERENTE"));
    const permisos = exito(await consultas.permisosDelActor(contexto));
    expect(permisos.acciones).not.toContain("comprobantes.ver");
    expect(permisos.acciones).toContain("usuarios.invitar");
    expect(permisos.modulos).toEqual({ activos: ["administracion"], enSoloLectura: [] });
  });

  it("sin activar el módulo no figura; con el módulo activo y en el plan, sí, y se ve en los módulos", async () => {
    const sinActivar = armar(
      () => ({ rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] }),
      CON_FACTURACION,
    );
    const a = exito(await sinActivar.consultas.permisosDelActor(contexto));
    expect(a.acciones).not.toContain("comprobantes.ver");
    expect(a.modulos).toEqual({ activos: ["administracion"], enSoloLectura: [] });

    const activo = armar(() => conFacturacionEnElPlan("GERENTE"), CON_FACTURACION);
    const b = exito(await activo.consultas.permisosDelActor(contexto));
    expect(b.modulos).toEqual({ activos: ["administracion", "facturacion"], enSoloLectura: [] });
  });

  it("un módulo fuera del plan queda en solo lectura: se puede mirar y cerrar, no crear", async () => {
    const { consultas } = armar(
      () => ({ rol: "GERENTE", modulosActivados: ["facturacion"], modulosHabilitados: [] }),
      CON_FACTURACION,
    );
    const permisos = exito(await consultas.permisosDelActor(contexto));
    expect(permisos.modulos).toEqual({
      activos: ["administracion"],
      enSoloLectura: ["facturacion"],
    });
    expect(permisos.acciones).toContain("comprobantes.ver");
    expect(permisos.acciones).toContain("notas_de_credito.emitir");
    expect(permisos.acciones).not.toContain("comprobantes.emitir_manual");
  });

  it("dice lo mismo que el guard acción por acción: lo que figura pasa exigirAccion y lo que no figura, no", async () => {
    for (const rol of ROLES_DE_EMPRESA) {
      const actor = conFacturacionEnElPlan(rol);
      const { consultas } = armar(() => actor, CON_FACTURACION);
      const { acciones } = exito(await consultas.permisosDelActor(contexto));
      for (const accion of Object.keys(
        PERMISOS_DE_EMPRESA,
      ) as (keyof typeof PERMISOS_DE_EMPRESA)[]) {
        const pasa = (await exigirAccion(CON_FACTURACION, accion, () => Promise.resolve(actor))).ok;
        expect(acciones.includes(accion), `${rol} ${accion}`).toBe(pasa);
      }
    }
  });

  it("sin membresía activa (sin rol) da SIN_PERMISO y no devuelve ni una acción", async () => {
    const { consultas } = armar(() => ({
      rol: null,
      modulosActivados: [],
      modulosHabilitados: [],
    }));
    expect(await consultas.permisosDelActor(contexto)).toEqual({ ok: false, error: "SIN_PERMISO" });
  });

  it("se calcula en cada pedido, en una transacción de solo lectura, leyendo al actor una sola vez (sin caché)", async () => {
    let actor: DatosDelActor = conFacturacionEnElPlan("GERENTE");
    const { consultas, aperturas, lecturasDelActor } = armar(() => actor, CON_FACTURACION);
    expect(exito(await consultas.permisosDelActor(contexto)).acciones).toContain("usuarios.apagar");
    expect(lecturasDelActor()).toBe(1);
    // Lo apagaron entre un pedido y el siguiente: el segundo ya no lo ve.
    actor = { rol: null, modulosActivados: [], modulosHabilitados: [] };
    expect(await consultas.permisosDelActor(contexto)).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(lecturasDelActor()).toBe(2);
    expect(aperturas).toEqual([
      { contexto, aislamiento: "read committed", soloLectura: true },
      { contexto, aislamiento: "read committed", soloLectura: true },
    ]);
  });

  it("D-59: el operador también recibe los módulos, incluso el que quedó solo para consultar", async () => {
    const { consultas } = armar(
      () => ({ rol: "OPERADOR", modulosActivados: ["facturacion"], modulosHabilitados: [] }),
      CON_FACTURACION,
    );
    const permisos = exito(await consultas.permisosDelActor(contexto));
    expect(permisos.modulos).toEqual({
      activos: ["administracion"],
      enSoloLectura: ["facturacion"],
    });
  });
});
