import { describe, expect, it } from "vitest";
import type { DefinicionDeTexto } from "../vocabulario/catalogo";
import {
  FUENTE_HEREDADA,
  USOS_PENDIENTES,
  type FuenteDeTexto,
  type UsoDeTexto,
} from "../vocabulario/uso-y-fuente-de-texto";
import { FICHAS, ESTADOS_DE_PANTALLA, type FichaDePantalla } from "./fichas";

// Estas pruebas fijan la FORMA de los tipos del inventario de textos y de la ficha de pantalla. Lo que no debe asignarse se declara con
// `SeAsigna<Destino, Valor> = false`: si el tipo se aflojara, `tsc` fallaría (sin `@ts-expect-error`, que es deuda registrada).
type SeAsigna<Destino, Valor> = [Valor] extends [Destino] ? true : false;

describe("tipos de usos y fuente de un texto", () => {
  it("usos y fuente son opcionales: un texto de hoy sigue siendo válido", () => {
    const hoy: DefinicionDeTexto = { porDefecto: "Cantidad" };
    expect(hoy.usos).toBeUndefined();
    expect(hoy.fuente).toBeUndefined();
  });

  it("admite usos por función, por dato, de ficha o pendientes, y la fuente por decisión o heredada", () => {
    const funcion: UsoDeTexto = { como: "FUNCION", archivo: "src/x.ts", nombre: "f" };
    const dato: UsoDeTexto = { como: "DATO", dato: "nombre-de-medio-de-pago" };
    const deFicha: UsoDeTexto = "DE_FICHA";
    const completo: DefinicionDeTexto = {
      porDefecto: "Guardar",
      usos: [funcion, dato, deFicha],
      fuente: { decision: "DEC-0410" },
    };
    const pendiente: DefinicionDeTexto = {
      porDefecto: "Guardar",
      usos: USOS_PENDIENTES,
      fuente: FUENTE_HEREDADA,
    };
    expect(completo.usos).toHaveLength(3);
    expect(pendiente.usos).toBe("pendiente");
  });

  it("no se asigna lo que está fuera de la lista", () => {
    const vacio: SeAsigna<DefinicionDeTexto, { porDefecto: "a"; usos: readonly [] }> = false;
    const sinDato: SeAsigna<UsoDeTexto, { como: "DATO"; dato: "no-existe" }> = false;
    const libre: SeAsigna<FuenteDeTexto, "lo aprobó el backend"> = false;
    const mal: SeAsigna<FuenteDeTexto, { decision: "ABC-1" }> = false;
    const bien: SeAsigna<FuenteDeTexto, { decision: "DEC-0410" }> = true;
    expect([vacio, sinDato, libre, mal, bien]).toEqual([false, false, false, false, true]);
  });
});

describe("tipos de la ficha de pantalla", () => {
  it("FICHAS nace vacío: ninguna pantalla está declarada todavía", () => {
    expect(Object.keys(FICHAS)).toEqual([]);
  });

  it("los estados son una lista cerrada", () => {
    expect(ESTADOS_DE_PANTALLA).toEqual([
      "CARGANDO",
      "VACIO",
      "ERROR",
      "SIN_PERMISO",
      "SOLO_LECTURA",
      "SIN_CONEXION",
    ]);
  });

  it("una ficha usa claves de texto, acciones y caminos que existen", () => {
    const ficha: FichaDePantalla = {
      id: "medios-de-pago",
      archivos: ["apps/web/app/x/page.tsx"],
      rutas: ["/caja/medios-de-pago"],
      titulo: "caja.medios.titulo",
      acceso: "medios_de_pago.editar",
      entradaDeMenu: null,
      caminos: ["agregar-medio-de-pago"],
      rotulos: { nombre: "caja.medios.titulo" },
      botones: [
        {
          id: "desactivar",
          texto: "caja.medios.titulo",
          hace: { envia: "medios_de_pago.desactivar" },
          sinPermiso: "APAGADO",
        },
      ],
      modales: [],
      estados: { ERROR: "GENERICO", VACIO: "caja.medios.titulo" },
      textos: [],
      estadoDeLaFicha: "EN_CONSTRUCCION",
    };
    expect(ficha.botones).toHaveLength(1);
  });

  it("no se asigna una ficha con una acción, una clave de texto o un camino inventados", () => {
    type Base = FichaDePantalla;
    const titulo: SeAsigna<Base, Omit<Base, "titulo"> & { titulo: "no.existe" }> = false;
    const acceso: SeAsigna<Base, Omit<Base, "acceso"> & { acceso: "no.existe" }> = false;
    const caminos: SeAsigna<Base, Omit<Base, "caminos"> & { caminos: readonly ["no-existe"] }> =
      false;
    const estados: SeAsigna<Base, Omit<Base, "estados"> & { estados: { OTRO: "GENERICO" } }> =
      false;
    const archivos: SeAsigna<Base, Omit<Base, "archivos"> & { archivos: readonly [] }> = false;
    expect([titulo, acceso, caminos, estados, archivos]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
