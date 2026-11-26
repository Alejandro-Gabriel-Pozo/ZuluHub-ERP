import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { cuentasAbiertasDeVentasParaStock } from "../../src/composicion/cuentas-abiertas-de-stock";
import { guardarLaReceta, type DependenciasDeRecetasWeb } from "../../src/composicion/recetas-web";
import { crearConsultasDeIdentidad } from "../../src/modulos/identidad/publico";
import {
  CONFIRMACION_DE_CUENTAS_ABIERTAS,
  crearCasosDeUsoDeStock,
  crearConsultasDeStock,
  type CasosDeUsoDeStock,
  type TxDeStock,
} from "../../src/modulos/stock/publico";
import type { Transacciones } from "../../src/puertos/transacciones";
import { productoDeBase } from "./catalogo-apoyo";
import type { TxDePrueba } from "./entorno";
import { RONDAS } from "./stock-casos-apoyo";
import { articuloDeBase, depositoDeBase } from "./stock-apoyo";
import {
  montarVentas,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * PRO-D1 (condición del dueño sobre DEC-PRO-001): al encender el stock propio de un plato con cuentas abiertas que lo tienen, el sistema pide confirmar y, sin confirmar, no escribe nada.
 * Con la base real, la perilla `produccion` encendida y el puerto cableado como en la aplicación (`cuentasAbiertasDeVentasParaStock`, una lectura de ventas en la misma transacción).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 900_000 });

const CON_CONFIRMACION = [CONFIRMACION_DE_CUENTAS_ABIERTAS];
const kilos = { unidadBase: "KILOGRAMO", dimension: "MASA" } as const;

describe.skipIf(base === null)(
  "encender el stock propio de un plato con cuentas abiertas (PRO-D1)",
  () => {
    let m: MundoDeVentas;
    let stock: CasosDeUsoDeStock;
    let recetas: DependenciasDeRecetasWeb;

    beforeAll(async () => {
      if (base === null) return;
      m = await montarVentas(base, {
        stock: true,
        produccion: true,
        conexiones: 16,
        ajustarTx: (tx: TxDePrueba): TxDePrueba => ({
          ...tx,
          derechos: {
            ...tx.derechos,
            deLaEmpresa: async (contexto) => {
              const reales = await tx.derechos.deLaEmpresa(contexto);
              return {
                ...reales,
                perillas: new Map(
                  [...reales.perillas].map(([perilla, valor]) => [
                    perilla,
                    perilla === "produccion" && valor.tipo === "INTERRUPTOR"
                      ? { ...valor, encendida: true }
                      : valor,
                  ]),
                ),
              };
            },
          },
        }),
      });
      const transacciones = m.entorno as unknown as Transacciones<TxDeStock>;
      stock = crearCasosDeUsoDeStock({
        transacciones,
        reglas: m.reglas,
        cuentasAbiertas: cuentasAbiertasDeVentasParaStock,
      });
      recetas = {
        casosDeUso: () => stock,
        consultas: () => crearConsultasDeStock({ transacciones, reglas: m.reglas }),
        personas: () => crearConsultasDeIdentidad({ transacciones: m.entorno, reglas: m.reglas }),
        respuesta: { registrar: () => undefined },
      };
    });
    afterAll(async () => {
      if (base !== null) await m.cerrar();
    });

    // ---- el escenario ---------------------------------------------------------------------------------------------------------------

    /** Una empresa con un plato (vendible, con precio y receta vigente) que todavía NO tiene stock propio. */
    const platoNuevo = async (): Promise<
      Readonly<{ e: EscenarioDeVentas; plato: string; insumo: string }>
    > => {
      const e = await m.escenario();
      await depositoDeBase(m.dueno, e, { deVenta: true });
      const harina = await articuloDeBase(m.dueno, e, { clase: "MATERIA_PRIMA", ...kilos });
      const plato = await productoDeBase(m.dueno, e.empresa, {
        clase: "VENDIBLE",
        unidadBase: "UNIDAD",
        dimension: "CONTEO",
      });
      await m.precio({
        empresa: e.empresa,
        producto: plato,
        precio: "1000",
        desde: "2026-01-01T00:00:00Z",
      });
      const r = await guardarLaReceta(recetas, e.gerente, {
        productoId: plato,
        versionEsperada: 0,
        rinde: "1",
        pasos: "",
        lineas: [{ ingredienteId: harina.producto, bruto: "0.1", merma: "" }],
        unidades: { [harina.producto]: "KILOGRAMO" },
      });
      if (!r.ok) throw new Error(`la receta no se guardó: ${JSON.stringify(r.error)}`);
      return { e, plato, insumo: harina.producto };
    };
    /** Abre una cuenta y le agrega una línea del plato. */
    const cuentaConElPlato = async (e: EscenarioDeVentas, plato: string) => {
      const cuenta = nuevoId();
      valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }));
      const linea = nuevoId();
      valorDe(
        await m.casos.agregarLinea(e.gerente, {
          cuentaId: cuenta,
          lineaId: linea,
          productoId: plato,
          opcionIds: [],
          cantidad: "1",
        }),
      );
      return { cuenta, linea };
    };
    const articulosDe = (plato: string) =>
      m.filas<{ id: string; activo: boolean }>(
        "select id, activo from articulo_de_stock where producto_id = $1",
        [plato],
      );
    const auditoriasDeControl = (empresa: string) =>
      m.filas<{ despues: Record<string, unknown> }>(
        "select despues from auditoria_empresa where empresa_id = $1 and accion = 'ARTICULO_CONTROLADO'",
        [empresa],
      );

    // ---- las pruebas ----------------------------------------------------------------------------------------------------------------

    it("sin confirmar no se escribe nada: ni el artículo ni la auditoría; el aviso dice que hay cuentas y nada más", async () => {
      const { e, plato } = await platoNuevo();
      await cuentaConElPlato(e, plato);
      const rechazo = await stock.controlarArticulo(e.gerente, { productoId: plato });
      expect(rechazo).toEqual({
        ok: false,
        error: { error: "CUENTAS_ABIERTAS_REQUIEREN_CONFIRMACION", cuentas: 1 },
      });
      expect(await articulosDe(plato)).toHaveLength(0);
      expect(await auditoriasDeControl(e.empresa)).toHaveLength(0);
    });

    it("confirmando se enciende, deja en la auditoría cuántas cuentas aceptó, y repetirlo con el artículo ya activo no pide nada (yaExistia)", async () => {
      const { e, plato } = await platoNuevo();
      await cuentaConElPlato(e, plato);
      await cuentaConElPlato(e, plato);
      const hecho = valorDe(
        await stock.controlarArticulo(e.gerente, {
          productoId: plato,
          confirmaciones: CON_CONFIRMACION,
        }),
      );
      expect(hecho.yaExistia).toBe(false);
      const repetido = valorDe(await stock.controlarArticulo(e.gerente, { productoId: plato }));
      expect(repetido).toEqual({ articuloId: hecho.articuloId, yaExistia: true });
      const repetidoConfirmado = valorDe(
        await stock.controlarArticulo(e.gerente, {
          productoId: plato,
          confirmaciones: CON_CONFIRMACION,
        }),
      );
      expect(repetidoConfirmado.yaExistia).toBe(true);
      expect(await articulosDe(plato)).toEqual([{ id: hecho.articuloId, activo: true }]);
      const auditorias = await auditoriasDeControl(e.empresa);
      expect(auditorias).toHaveLength(1);
      expect(auditorias[0]?.despues).toMatchObject({ cuentasAbiertasAceptadas: 2 });
    });

    it("sin cuentas abiertas con el plato se enciende sin pedir nada; una cuenta cerrada o con otro producto no cuenta", async () => {
      const { e, plato } = await platoNuevo();
      const otro = await productoDeBase(m.dueno, e.empresa, {
        clase: "VENDIBLE",
        unidadBase: "UNIDAD",
        dimension: "CONTEO",
      });
      await m.precio({
        empresa: e.empresa,
        producto: otro,
        precio: "500",
        desde: "2026-01-01T00:00:00Z",
      });
      await cuentaConElPlato(e, otro);
      const cerrada = await cuentaConElPlato(e, plato);
      valorDe(
        await m.casos.cerrarCuenta(e.gerente, { cuentaId: cerrada.cuenta, ejemplarId: nuevoId() }),
      );
      const hecho = valorDe(await stock.controlarArticulo(e.gerente, { productoId: plato }));
      expect(hecho.yaExistia).toBe(false);
      expect(await auditoriasDeControl(e.empresa)).toHaveLength(1);
      expect((await auditoriasDeControl(e.empresa))[0]?.despues).not.toHaveProperty(
        "cuentasAbiertasAceptadas",
      );
    });

    it("una línea anulada no cuenta: con la única línea del plato anulada se enciende sin pedir", async () => {
      const { e, plato } = await platoNuevo();
      const { cuenta, linea } = await cuentaConElPlato(e, plato);
      valorDe(
        await m.casos.anularLinea(e.gerente, {
          cuentaId: cuenta,
          lineaId: linea,
          motivo: "error de carga",
        }),
      );
      const hecho = valorDe(await stock.controlarArticulo(e.gerente, { productoId: plato }));
      expect(hecho.yaExistia).toBe(false);
    });

    it("reactivar un artículo apagado con cuentas abiertas también pide confirmar, y sin confirmar sigue apagado", async () => {
      const { e, plato } = await platoNuevo();
      valorDe(
        await stock.controlarArticulo(e.gerente, {
          productoId: plato,
          confirmaciones: CON_CONFIRMACION,
        }),
      );
      valorDe(await stock.dejarDeControlar(e.gerente, { productoId: plato }));
      await cuentaConElPlato(e, plato);
      const rechazo = await stock.controlarArticulo(e.gerente, { productoId: plato });
      expect(rechazo).toMatchObject({
        ok: false,
        error: { error: "CUENTAS_ABIERTAS_REQUIEREN_CONFIRMACION", cuentas: 1 },
      });
      expect((await articulosDe(plato))[0]?.activo).toBe(false);
      valorDe(
        await stock.controlarArticulo(e.gerente, {
          productoId: plato,
          confirmaciones: CON_CONFIRMACION,
        }),
      );
      expect((await articulosDe(plato))[0]?.activo).toBe(true);
    });

    it("una confirmación que no es la declarada se rechaza (lista de permitidos) y no escribe", async () => {
      const { e, plato } = await platoNuevo();
      const r = await stock.controlarArticulo(e.gerente, {
        productoId: plato,
        confirmaciones: ["cualquier.otra"],
      });
      expect(r).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
      expect(await articulosDe(plato)).toHaveLength(0);
    });

    it("aislamiento por empresa: las cuentas de una empresa no frenan ni se cuentan en otra, y el plato de una no se enciende desde otra", async () => {
      const a = await platoNuevo();
      const b = await platoNuevo();
      await cuentaConElPlato(a.e, a.plato);
      // La empresa B no tiene cuentas: su plato se enciende sin pedir, aunque A tenga una abierta.
      expect(
        valorDe(await stock.controlarArticulo(b.e.gerente, { productoId: b.plato })).yaExistia,
      ).toBe(false);
      // Desde B no se ve el plato de A: no se confirma ni se cuenta nada ajeno.
      const ajeno = await stock.controlarArticulo(b.e.gerente, {
        productoId: a.plato,
        confirmaciones: CON_CONFIRMACION,
      });
      expect(ajeno).toEqual({ ok: false, error: "PRODUCTO_NO_ENCONTRADO" });
      expect(await articulosDe(a.plato)).toHaveLength(0);
      expect(await auditoriasDeControl(b.e.empresa)).toHaveLength(1);
    });

    it(`encender a la vez que se agrega una línea del plato a una cuenta abierta (${RONDAS} rondas): nunca queda encendido sin confirmar con una cuenta abierta que lo descuenta de otro modo`, async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const { e, plato } = await platoNuevo();
        const cuenta = nuevoId();
        valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }));
        const lineaId = nuevoId();
        const agregar = async () => {
          const r = await m.casos.agregarLinea(e.gerente, {
            cuentaId: cuenta,
            lineaId,
            productoId: plato,
            opcionIds: [],
            cantidad: "1",
          });
          return { que: "linea" as const, ok: r.ok };
        };
        const encender = async () => {
          const r = await stock.controlarArticulo(e.gerente, { productoId: plato });
          return { que: "control" as const, ok: r.ok, r };
        };
        m.armarBarrera(2);
        let resultados: Array<
          Awaited<ReturnType<typeof agregar>> | Awaited<ReturnType<typeof encender>>
        >;
        try {
          resultados = await Promise.all(
            ronda % 2 === 0 ? [agregar(), encender()] : [encender(), agregar()],
          );
        } finally {
          m.soltarBarrera();
        }
        const linea = resultados.find((x) => x.que === "linea");
        expect(linea?.ok).toBe(true);
        const control = resultados.find((x) => x.que === "control");
        const articulos = await articulosDe(plato);
        const marca = await m.filas<{ c: boolean }>(
          "select controla_stock as c from linea_cuenta where id = $1",
          [lineaId],
        );
        if (articulos.some((x) => x.activo)) {
          // Se encendió sin confirmar: solo es válido si no había cuenta con el plato al decidir, y entonces la línea ve el artículo y descuenta el plato.
          expect(control?.ok).toBe(true);
          expect(marca[0]?.c).toBe(true);
        } else {
          // La línea entró primero: el encendido pidió confirmar y no escribió nada.
          expect(control?.ok).toBe(false);
          expect(await auditoriasDeControl(e.empresa)).toHaveLength(0);
        }
      }
    });

    it("dos encendidos confirmados a la vez dejan un solo artículo y una sola auditoría (idempotencia)", async () => {
      const { e, plato } = await platoNuevo();
      await cuentaConElPlato(e, plato);
      m.armarBarrera(2);
      let r: Awaited<ReturnType<CasosDeUsoDeStock["controlarArticulo"]>>[];
      try {
        r = await Promise.all([
          stock.controlarArticulo(e.gerente, {
            productoId: plato,
            confirmaciones: CON_CONFIRMACION,
          }),
          stock.controlarArticulo(e.gerente, {
            productoId: plato,
            confirmaciones: CON_CONFIRMACION,
          }),
        ]);
      } finally {
        m.soltarBarrera();
      }
      expect(r.every((x) => x.ok)).toBe(true);
      expect(await articulosDe(plato)).toHaveLength(1);
      expect(await auditoriasDeControl(e.empresa)).toHaveLength(1);
    });
  },
);
