import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, it, inject, vi } from "vitest";
import { crearBaseAparte } from "./entorno";
import { acepta, check, conAppDe, crearMundo, type Mundo } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import type { SesionDePrueba } from "./sesiones";

/**
 * D2 (auditoría de salón, INTEGRACION §5): `copias_cuadran` (0038) vigila que la copia de una línea conserve lo congelado de la origen, pero 0047 sumó a lo
 * congelado el departamento y el camino de clasificación y el disparador no los miraba: una copia podía cambiarlos y la base la aceptaba (solo lo impedía el
 * código de `copiar-linea.ts`). Previene: un traslado o una división que reclasifica en silencio lo vendido (el reporte por departamento cambia).
 * Corrección: migración 0055 (reemplaza la función, aditiva y reversible).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const AHORA = "2026-11-09T15:00:00Z";
const uuid = () => randomUUID();

type Clasificacion = Readonly<{ departamento: string; camino: string }> | null;

describe.skipIf(base === null)("0055 (D2): copias_cuadran y la clasificación congelada", () => {
  const b = () => base as BaseDePruebas;
  let aparte: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let m: Mundo;
  let ventas: Clasificacion;
  let bebidas: Clasificacion;

  const nodo = async (nombre: string): Promise<Clasificacion> => {
    const id = uuid();
    await dueno.query(
      "insert into nodo_de_clasificacion (id, empresa_id, padre_id, nombre, nombre_clave) values ($1, $2, null, $3, lower($3))",
      [id, m.empresa, nombre],
    );
    return { departamento: id, camino: JSON.stringify([{ id, nombre }]) };
  };

  beforeAll(async () => {
    aparte = await crearBaseAparte(b());
    dueno = new pg.Client({ connectionString: aparte.base.dueno });
    await dueno.connect();
    m = await crearMundo(dueno);
    ventas = await nodo("Ventas");
    bebidas = await nodo("Bebidas");
  });
  afterAll(async () => {
    await dueno.end();
    await aparte.destruir();
  });

  const app = <T>(trabajo: (s: SesionDePrueba) => Promise<T>) => conAppDe(aparte.base, m, trabajo);

  async function cuenta(s: SesionDePrueba): Promise<string> {
    const id = uuid();
    acepta(
      await s.directo(
        `insert into cuenta_consumo (id, empresa_id, sucursal_id, abierta_por, abierta_en) values ($1, $2, $3, $4, $5)`,
        [id, m.empresa, m.sucursal, m.persona, AHORA],
      ),
    );
    return id;
  }

  async function total(s: SesionDePrueba, cuentaId: string): Promise<void> {
    acepta(
      await s.directo(
        `update cuenta_consumo set total_provisorio = (
           select round(coalesce(sum(coalesce(l.importe_fijo, l.precio_unitario * l.cantidad)), 0), 2)
             from linea_cuenta l where l.cuenta_id = $1 and l.empresa_id = $2 and l.estado = 'VIGENTE')
         where id = $1 and empresa_id = $2`,
        [cuentaId, m.empresa],
      ),
    );
  }

  async function linea(
    s: SesionDePrueba,
    cuentaId: string,
    clase: Clasificacion,
    cocina: string | null = null,
  ): Promise<string> {
    const id = uuid();
    const r = await s.directo(
      `update cuenta_consumo set ultima_posicion = ultima_posicion + 1 where id = $1 and empresa_id = $2 returning ultima_posicion`,
      [cuentaId, m.empresa],
    );
    acepta(r);
    acepta(
      await s.directo(
        `insert into linea_cuenta (id, empresa_id, cuenta_id, posicion, producto_id, descripcion, precio_id, origen_del_precio, precio_base,
                                   precio_unitario, cantidad, unidad_de_venta, paso_de_cantidad, alicuota, controla_stock, creada_por, creada_en,
                                   departamento_id, camino_de_clasificacion${cocina === null ? "" : ", nombre_de_cocina"})
         values ($1, $2, $3, $4, $5, 'Pizza', $6, 'EMPRESA', 1000, 1000, 1, 'UNIDAD', 1, '21', false, $7, $8, $9, $10::jsonb${cocina === null ? "" : ", $11"})`,
        [
          id,
          m.empresa,
          cuentaId,
          r.ok ? r.rows[0]?.["ultima_posicion"] : 1,
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000002",
          m.persona,
          AHORA,
          clase?.departamento ?? null,
          clase?.camino ?? null,
          ...(cocina === null ? [] : [cocina]),
        ],
      ),
    );
    return id;
  }

  /** Traslada entera una línea de la cuenta 1 a la 2 con la clasificación indicada para la copia, y fuerza los controles diferidos. */
  async function trasladar(
    origenClase: Clasificacion,
    copiaClase: Clasificacion,
    cocinas: readonly [string | null, string | null] = [null, null],
  ) {
    return app(async (s) => {
      const c1 = await cuenta(s);
      const c2 = await cuenta(s);
      const origen = await linea(s, c1, origenClase, cocinas[0]);
      await total(s, c1);
      acepta(
        await s.directo(
          `update linea_cuenta set estado = 'ANULADA', anulada_por = $3, anulada_en = $4, motivo_de_anulacion = 'TRASLADADA' where id = $1 and empresa_id = $2`,
          [origen, m.empresa, m.persona, AHORA],
        ),
      );
      await total(s, c1);
      const nueva = await linea(s, c2, copiaClase, cocinas[1]);
      await total(s, c2);
      acepta(
        await s.directo(
          `insert into linea_copiada (empresa_id, linea_nueva_id, linea_origen_id, modo) values ($1, $2, $3, 'COMPLETA')`,
          [m.empresa, nueva, origen],
        ),
      );
      return s.intentar("set constraints all immediate");
    });
  }

  it("la copia con la misma clasificación pasa", async () => {
    acepta(await trasladar(ventas, ventas));
    acepta(await trasladar(null, null));
  });

  it("una copia que cambia el departamento se rechaza (copias_cuadran)", async () => {
    check(await trasladar(ventas, bebidas), "copias_cuadran");
  });

  it("una copia que pierde la clasificación, o la gana donde la origen no tenía, se rechaza", async () => {
    check(await trasladar(ventas, null), "copias_cuadran");
    check(await trasladar(null, ventas), "copias_cuadran");
  });

  it("una copia con el mismo departamento pero otro camino (otro nombre congelado) se rechaza", async () => {
    const otroNombre: Clasificacion = {
      departamento: (ventas as NonNullable<Clasificacion>).departamento,
      camino: JSON.stringify([
        { id: (ventas as NonNullable<Clasificacion>).departamento, nombre: "Ventas viejas" },
      ]),
    };
    check(await trasladar(ventas, otroNombre), "copias_cuadran");
  });

  it("D3: la copia conserva el nombre de cocina congelado de la origen (también el nulo)", async () => {
    acepta(await trasladar(ventas, ventas, ["Medallón", "Medallón"]));
    check(await trasladar(ventas, ventas, ["Medallón", "Otro"]), "copias_cuadran");
    check(await trasladar(ventas, ventas, ["Medallón", null]), "copias_cuadran");
    check(await trasladar(ventas, ventas, [null, "Medallón"]), "copias_cuadran");
  });

  it("la reversión devuelve la función de 0038 (la base vuelve a aceptar el cambio) y la migración se puede volver a aplicar", async () => {
    const carpeta = join(import.meta.dirname, "../../migraciones");
    const reversion = await readFile(
      join(carpeta, "reversiones/0055_revertir_salon_copias_y_nombre_de_cocina.sql"),
      "utf8",
    );
    await dueno.query(reversion);
    acepta(await trasladar(ventas, bebidas));
    const migracion = await readFile(
      join(carpeta, "0055_salon_copias_y_nombre_de_cocina.sql"),
      "utf8",
    );
    await dueno.query(migracion);
    check(await trasladar(ventas, bebidas), "copias_cuadran");
  });
});
