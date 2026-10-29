import { describe, expect, it } from "vitest";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../../../test/utilidades/marcas";
import { CATALOGO_DE_MODULOS } from "../../../capacidades/modulos/catalogo";
import {
  PERMISOS_DE_EMPRESA,
  REGLAS_DE_EMPRESA,
  type ReglasDeEmpresa,
} from "../../../capacidades/permisos/empresa";
import { ROLES_DE_EMPRESA } from "../../../capacidades/permisos/roles";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { cuitDesdeTexto, type Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import { empresaId, personaId } from "../../../primitivas/identificadores/marca";
import type { DatosDelActor } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import { certificadoId, emisorId } from "../publico";
import type { CertificadoGuardado } from "../persistencia/repositorio-de-certificados";
import { crearConsultasDeFacturacion } from "./consultas";
import type { TxDeConsultasDeFacturacion } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/**
 * El estado de los certificados (D-42) sin base de datos: que el guard va primero (con una transacción VIGILADA que corta
 * en el primer acceso que no sea la autorización) y cómo se arma cada situación a partir de lo que devuelve el repositorio.
 * Contra una base real, con los roles reales, está en `test/integracion/certificados-estado.test.ts`.
 */

const AHORA = new Date("2026-10-29T12:00:00.000Z");
const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: AHORA,
};
const EMISOR = emisorId("emisor-1");
const cuit = (texto: string): Cuit => {
  const r = cuitDesdeTexto(texto);
  if (!r.ok) throw new Error("CUIT de prueba");
  return r.valor;
};

const CON_FACTURACION: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    facturacion: { ...CATALOGO_DE_MODULOS.facturacion, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};
const actor = (rol: DatosDelActor["rol"], extra: Partial<DatosDelActor> = {}): DatosDelActor => ({
  rol,
  modulosActivados: ["facturacion"],
  modulosHabilitados: ["facturacion"],
  ...extra,
});

/** Un certificado guardado con lo mínimo; `cambios` pisa lo que la prueba quiera. */
const guardado = (cambios: Partial<CertificadoGuardado> = {}): CertificadoGuardado => ({
  id: certificadoId("cert-1"),
  empresaId: empresaId("e-1"),
  emisorId: EMISOR,
  ambiente: "HOMOLOGACION",
  alias: "pedernal1",
  cuitTitular: cuit("20123456786"),
  estado: "VIGENTE",
  pedidoPem: "PEDIDO-SECRETO-NO-SALE",
  certificadoPem: "CERTIFICADO-NO-SALE",
  huellaSha256: "h".repeat(64),
  venceEn: new Date("2027-01-01T00:00:00.000Z"),
  autorizacionVerificadaEn: null,
  creadoPor: personaId("p-1"),
  creadoEn: new Date("2026-10-01T00:00:00.000Z"),
  version: 3,
  ...cambios,
});

type Registro = { accesos: string[]; pedidos: unknown[][] };

/** Una transacción cuyo repositorio contesta lo programado por ambiente; cuenta qué se tocó. */
function armar(
  datos: DatosDelActor,
  porAmbiente: Partial<
    Record<
      "HOMOLOGACION" | "PRODUCCION",
      | CertificadoGuardado
      | Readonly<{ vigente: CertificadoGuardado | null; pendiente: CertificadoGuardado | null }>
    >
  > = {},
  emisorExiste = true,
  reglas: ReglasDeEmpresa = CON_FACTURACION,
) {
  const registro: Registro = { accesos: [], pedidos: [] };
  const tx = {
    autorizacion: {
      delActor: () => Promise.resolve(datos),
      sucursalesDelActor: () => Promise.resolve("TODAS" as const),
    },
    emisores: {
      obtener: (...a: unknown[]) => {
        registro.accesos.push("emisores");
        registro.pedidos.push(a);
        return Promise.resolve(emisorExiste ? ({ id: EMISOR } as never) : null);
      },
    },
    lecturasDeCertificados: {
      actualesDelEmisor: () => {
        registro.accesos.push("certificados");
        return Promise.resolve(
          (["HOMOLOGACION", "PRODUCCION"] as const).map((ambiente) => {
            const dado = porAmbiente[ambiente];
            if (dado === undefined) return { ambiente, vigente: null, pendiente: null };
            if ("vigente" in dado) return { ambiente, ...dado };
            return dado.estado === "VIGENTE"
              ? { ambiente, vigente: dado, pendiente: null }
              : { ambiente, vigente: null, pendiente: dado };
          }),
        );
      },
    },
  } as unknown as TxDeConsultasDeFacturacion;
  const opciones: unknown[] = [];
  const transacciones: Transacciones<TxDeConsultasDeFacturacion> = {
    ejecutar: (o, trabajo) => {
      opciones.push(o);
      return trabajo(tx);
    },
  };
  return {
    consultas: crearConsultasDeFacturacion({ transacciones, reglas }),
    registro,
    opciones,
  };
}

const ver = (m: ReturnType<typeof armar>) =>
  m.consultas.estadoDeCertificados(contexto, { emisorId: EMISOR });

describe("el guard va primero en el estado de los certificados", () => {
  it("la consulta exige certificados.gestionar (el gerente: D-43), no comprobantes.ver", () => {
    expect(DECLARACIONES_DE_CONSULTAS.estadoDeCertificados).toEqual({
      accion: "certificados.gestionar",
    });
    expect(PERMISOS_DE_EMPRESA["certificados.gestionar"]).toEqual(["GERENTE"]);
  });

  it("sin rol, o con un rol que no es gerente, da SIN_PERMISO sin tocar el emisor ni los certificados", async () => {
    for (const rol of [null, "ADMINISTRADOR", "OPERADOR"] as const) {
      const m = armar(actor(rol));
      expect(await ver(m), String(rol)).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(m.registro.accesos).toEqual([]);
    }
  });

  it("con el catálogo REAL todavía no se puede usar (MODULO_EN_DESARROLLO) y con la facturación sin activar, MODULO_NO_ACTIVO", async () => {
    const real = armar(actor("GERENTE"), {}, true, REGLAS_DE_EMPRESA);
    expect(await ver(real)).toEqual({ ok: false, error: "MODULO_EN_DESARROLLO" });
    const sinActivar = armar(actor("GERENTE", { modulosActivados: [], modulosHabilitados: [] }));
    expect(await ver(sinActivar)).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
    expect(real.registro.accesos).toEqual([]);
    expect(sinActivar.registro.accesos).toEqual([]);
  });

  it("con el plan dado de baja (módulo en solo lectura) se rechaza: reutiliza la acción de gestionar, que amplía", async () => {
    const m = armar(actor("GERENTE", { modulosHabilitados: [] }));
    expect(await ver(m)).toEqual({ ok: false, error: "MODULO_EN_SOLO_LECTURA" });
    expect(m.registro.accesos).toEqual([]);
  });

  it("la gerencia pasa y la transacción es de solo lectura, en read committed", async () => {
    const m = armar(actor("GERENTE"));
    expect((await ver(m)).ok).toBe(true);
    expect(m.opciones).toEqual([{ contexto, aislamiento: "read committed", soloLectura: true }]);
    expect(ROLES_DE_EMPRESA).toContain("GERENTE");
  });
});

describe("las situaciones salen de lo que guardó el repositorio", () => {
  it("un emisor que no existe es EMISOR_NO_ENCONTRADO y no consulta certificados", async () => {
    const m = armar(actor("GERENTE"), {}, false);
    expect(await ver(m)).toEqual({ ok: false, error: "EMISOR_NO_ENCONTRADO" });
    expect(m.registro.accesos).toEqual(["emisores"]);
  });

  it("sin nada, falta cargar en los dos ambientes y en este orden: homologación, producción", async () => {
    const m = armar(actor("GERENTE"));
    expect(await ver(m)).toEqual({
      ok: true,
      valor: [
        { ambiente: "HOMOLOGACION", situacion: "FALTA_CARGAR" },
        { ambiente: "PRODUCCION", situacion: "FALTA_CARGAR" },
      ],
    });
    // El emisor y UNA sola lectura de certificados para los dos ambientes.
    expect(m.registro.accesos).toEqual(["emisores", "certificados"]);
  });

  it("un pedido sin certificado es PEDIDO_GENERADO con su id, alias, titular y fecha, y nada del contenido", async () => {
    const pedido = guardado({
      estado: "PEDIDO_GENERADO",
      certificadoPem: null,
      huellaSha256: null,
      venceEn: null,
    });
    const r = await ver(armar(actor("GERENTE"), { HOMOLOGACION: pedido }));
    expect(r).toEqual({
      ok: true,
      valor: [
        {
          ambiente: "HOMOLOGACION",
          situacion: "PEDIDO_GENERADO",
          certificadoId: pedido.id,
          alias: "pedernal1",
          cuitTitular: pedido.cuitTitular,
          creadoEn: pedido.creadoEn,
        },
        { ambiente: "PRODUCCION", situacion: "FALTA_CARGAR" },
      ],
    });
    expect(JSON.stringify(r)).not.toContain("NO-SALE");
  });

  it("un vigente muestra cuándo vence, si ya venció y si la autorización está sin verificar o verificada", async () => {
    const sin = guardado();
    const verificada = guardado({
      ambiente: "PRODUCCION",
      autorizacionVerificadaEn: new Date("2026-10-28T10:00:00.000Z"),
    });
    const r = await ver(armar(actor("GERENTE"), { HOMOLOGACION: sin, PRODUCCION: verificada }));
    expect(r).toEqual({
      ok: true,
      valor: [
        {
          ambiente: "HOMOLOGACION",
          situacion: "VIGENTE",
          certificadoId: sin.id,
          alias: "pedernal1",
          cuitTitular: sin.cuitTitular,
          venceEn: sin.venceEn,
          vencido: false,
          autorizacion: { estado: "SIN_VERIFICAR" },
          pedidoPendiente: null,
        },
        {
          ambiente: "PRODUCCION",
          situacion: "VIGENTE",
          certificadoId: verificada.id,
          alias: "pedernal1",
          cuitTitular: verificada.cuitTitular,
          venceEn: verificada.venceEn,
          vencido: false,
          autorizacion: { estado: "VERIFICADA", en: new Date("2026-10-28T10:00:00.000Z") },
          pedidoPendiente: null,
        },
      ],
    });
    expect(JSON.stringify(r)).not.toContain("NO-SALE");
    expect(JSON.stringify(r)).not.toContain("hhhh");
  });

  it("un vigente con una renovación en curso devuelve también el pedido pendiente (id, alias, titular y fecha), sin su contenido", async () => {
    const vigente = guardado({ autorizacionVerificadaEn: new Date("2026-10-28T10:00:00.000Z") });
    const pendiente = guardado({
      id: certificadoId("cert-2"),
      alias: "renovacion",
      cuitTitular: cuit("30703088534"),
      estado: "PEDIDO_GENERADO",
      certificadoPem: null,
      huellaSha256: null,
      venceEn: null,
      creadoEn: new Date("2026-10-20T00:00:00.000Z"),
    });
    const r = await ver(armar(actor("GERENTE"), { HOMOLOGACION: { vigente, pendiente } }));
    expect(r).toMatchObject({
      ok: true,
      valor: [
        {
          ambiente: "HOMOLOGACION",
          situacion: "VIGENTE",
          certificadoId: vigente.id,
          autorizacion: { estado: "VERIFICADA" },
          pedidoPendiente: {
            certificadoId: pendiente.id,
            alias: "renovacion",
            cuitTitular: pendiente.cuitTitular,
            creadoEn: pendiente.creadoEn,
          },
        },
        { ambiente: "PRODUCCION", situacion: "FALTA_CARGAR" },
      ],
    });
    const mostrado = (r.ok ? r.valor[0] : null) as { pedidoPendiente: object } | null;
    // El pedido pendiente trae solo esos cuatro datos: ni el pedido (CSR), ni PEM, ni huella, ni clave.
    expect(Object.keys(mostrado?.pedidoPendiente ?? {}).sort()).toEqual([
      "alias",
      "certificadoId",
      "creadoEn",
      "cuitTitular",
    ]);
    expect(JSON.stringify(r)).not.toContain("NO-SALE");
  });

  it("vencido es venceEn <= ahora: justo en el instante ya venció, un milisegundo antes no", async () => {
    const vencidoEn = async (venceEn: Date) => {
      const r = await ver(armar(actor("GERENTE"), { HOMOLOGACION: guardado({ venceEn }) }));
      return r.ok ? (r.valor[0] as { vencido: boolean }).vencido : null;
    };
    expect(await vencidoEn(new Date(AHORA.getTime() + 1))).toBe(false);
    expect(await vencidoEn(AHORA)).toBe(true);
    expect(await vencidoEn(new Date(AHORA.getTime() - 1))).toBe(true);
  });

  it("un vigente sin vencimiento no puede existir (lo impide la base): si apareciera, es un defecto y se corta", async () => {
    await expect(
      ver(armar(actor("GERENTE"), { HOMOLOGACION: guardado({ venceEn: null }) })),
    ).rejects.toThrow("un certificado vigente sin vencimiento");
  });
});
