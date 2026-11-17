import { describe, expect, it } from "vitest";
import type { DefinicionDeCamino } from "../../src/capacidades/datos/caminos";
import type { Registro } from "./campos-con-dato-apoyo";
import { problemasDeLosCaminos, type Caminos } from "./caminos-declarados-apoyo";

/**
 * Una violación inyectada por cada chequeo de los caminos declarados (regla 5.b): si alguien debilita el verificador, el caso correspondiente deja de fallar y esta prueba
 * lo delata. El camino de partida es válido; cada caso rompe UNA cosa.
 */
const PANTALLA = "apps/web/ui/x/Formulario.cliente.tsx";
const registro = {
  "tipo-de-medio-de-pago": { consumidores: [PANTALLA] },
  "nombre-de-medio-de-pago": { consumidores: [PANTALLA] },
} as unknown as Registro;

const bueno: DefinicionDeCamino = {
  funcion: "Agregar un medio",
  pantallas: [PANTALLA],
  pasos: [
    {
      id: "datos",
      campos: { tipo: "tipo-de-medio-de-pago", nombre: "nombre-de-medio-de-pago" },
    },
  ],
  deriva: [],
  accion: {
    clave: "medios_de_pago.crear",
    requiere: ["tipo-de-medio-de-pago"],
    admite: ["nombre-de-medio-de-pago"],
  },
  camposDeError: ["nombre"],
};
const con = (cambios: Partial<DefinicionDeCamino>): Caminos => ({ c: { ...bueno, ...cambios } });
const siempre = () => true;
const problemas = (caminos: Caminos, existe: (r: string) => boolean = siempre) =>
  problemasDeLosCaminos(caminos, registro, existe);

describe("caminos declarados: violaciones inyectadas", () => {
  it("el camino de partida es válido", () => {
    expect(problemas({ c: bueno })).toEqual([]);
  });

  it("(a) la acción exige un dato que ningún paso completa ni se deriva", () => {
    const r = problemas(
      con({
        pasos: [{ id: "datos", campos: { nombre: "nombre-de-medio-de-pago" } }],
      }),
    );
    expect(r).toEqual([
      "c: la acción «medios_de_pago.crear» exige el dato «tipo-de-medio-de-pago» y ningún paso lo completa ni se deriva",
    ]);
  });

  it("(a) un dato derivado SÍ cubre lo que la acción exige", () => {
    expect(
      problemas(
        con({
          pasos: [{ id: "datos", campos: { nombre: "nombre-de-medio-de-pago" } }],
          deriva: ["tipo-de-medio-de-pago"],
        }),
      ),
    ).toEqual([]);
  });

  it("(b) un paso pide un dato que la acción no exige ni admite", () => {
    const r = problemas(
      con({ accion: { ...bueno.accion, requiere: ["tipo-de-medio-de-pago"], admite: [] } }),
    );
    expect(r).toEqual([
      "c: el paso «datos» pide el dato «nombre-de-medio-de-pago» y la acción «medios_de_pago.crear» no lo exige ni lo admite",
    ]);
  });

  it("(c) el servidor puede devolver un error en un campo que ningún paso tiene", () => {
    expect(problemas(con({ camposDeError: ["nombre", "domicilio"] }))).toEqual([
      "c: el servidor puede devolver un error en el campo «domicilio» y ningún paso lo tiene",
    ]);
  });

  it("la acción tiene que existir en el catálogo", () => {
    const r = problemas(
      con({ accion: { ...bueno.accion, clave: "medios_de_pago.inventada" as never } }),
    );
    expect(r).toEqual(["c: la acción «medios_de_pago.inventada» no existe en el catálogo"]);
  });

  it("la pantalla tiene que existir", () => {
    expect(problemas({ c: bueno }, () => false)).toEqual([`c: la pantalla ${PANTALLA} no existe`]);
  });

  it("todo dato tiene que estar en el registro", () => {
    const r = problemas(
      con({
        pasos: [
          {
            id: "datos",
            campos: {
              tipo: "tipo-de-medio-de-pago",
              nombre: "nombre-de-medio-de-pago",
              x: "inventado" as never,
            },
          },
        ],
      }),
    );
    expect(r).toContain("c: el dato «inventado» no está en el registro");
  });

  it("la pantalla del camino tiene que figurar como consumidora de cada dato que un paso completa", () => {
    const r = problemasDeLosCaminos(
      { c: bueno },
      {
        ...registro,
        "nombre-de-medio-de-pago": { consumidores: ["otra/Pantalla.tsx"] },
      } as unknown as Registro,
      siempre,
    );
    expect(r).toEqual([
      "c: ninguna pantalla del camino figura como consumidora del dato «nombre-de-medio-de-pago» en el registro",
    ]);
  });
});
