import type { MarcaPublica } from "../../src/capacidades/experiencia/puerta";
import { normalizarHost } from "../../src/modulos/marcas/publico";
import type { MarcaComercialId } from "../../src/primitivas/identificadores/marca";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import type { HostResuelto, ResolucionDeHost, SuperficieDeHost } from "../../src/puertos/marcas";
import { MARCA_PRINCIPAL_DE_PRUEBA, OTRA_MARCA_DE_PRUEBA } from "./marcas";

/**
 * El FALSO de la puerta pública para las pruebas de la web (W4): dos marcas sembradas, A y B, cada una
 * con sus dominios (superficies APP, LANDING, CARTA y una CONSOLA que esta app no sirve; estados ACTIVO
 * y RETIRADO). Imita lo que garantiza el puerto real (`ResolucionDeHost`): coincidencia exacta del host
 * ya normalizado, solo dominios ACTIVOS en esa superficie, todo lo demás `ok(null)`, y un fallo de la
 * base como `err`. Los nombres de A y de B no comparten ninguna palabra: una fuga de B en una respuesta
 * de A (o a la inversa) se detecta buscando el texto.
 */
export type MarcaSembrada = Readonly<{
  id: MarcaComercialId;
  publica: MarcaPublica;
  /** Palabras que solo existen en esta marca: ninguna respuesta de la otra las puede traer. */
  senas: readonly string[];
}>;

export const MARCA_A: MarcaSembrada = {
  id: MARCA_PRINCIPAL_DE_PRUEBA,
  publica: {
    nombre: "Hotel del Lago",
    tema: {
      primary: "#7a1f1f",
      "on-primary": "#ffffff",
      secondary: "#444444",
      accent: "#a15c00",
    },
    hostDeApp: "app.hoteldellago.test",
  },
  senas: ["Hotel del Lago", "hoteldellago", "#7a1f1f", "#a15c00"],
};

export const MARCA_B: MarcaSembrada = {
  id: OTRA_MARCA_DE_PRUEBA,
  publica: {
    nombre: "Panadería Los Pinos",
    tema: {
      primary: "#1f5e3a",
      "on-primary": "#ffffff",
      secondary: "#2d2d2d",
      accent: "#0b6b8a",
    },
    hostDeApp: "app.panaderialospinos.test",
  },
  senas: ["Panadería Los Pinos", "panaderialospinos", "#1f5e3a", "#0b6b8a"],
};

type Estado = "ACTIVO" | "RETIRADO";
const DOMINIOS: readonly (readonly [string, SuperficieDeHost, MarcaSembrada, Estado])[] = [
  ["app.hoteldellago.test", "APP", MARCA_A, "ACTIVO"],
  ["hoteldellago.test", "LANDING", MARCA_A, "ACTIVO"],
  ["carta.hoteldellago.test", "CARTA", MARCA_A, "ACTIVO"],
  ["consola.hoteldellago.test", "CONSOLA", MARCA_A, "ACTIVO"],
  ["viejo.hoteldellago.test", "APP", MARCA_A, "RETIRADO"],
  ["app.panaderialospinos.test", "APP", MARCA_B, "ACTIVO"],
  ["panaderialospinos.test", "LANDING", MARCA_B, "ACTIVO"],
  ["carta.panaderialospinos.test", "CARTA", MARCA_B, "ACTIVO"],
  ["vieja.panaderialospinos.test", "LANDING", MARCA_B, "RETIRADO"],
];

/** Los hosts ACTIVOS de la APP de cada marca, para las pruebas que solo necesitan uno bueno. */
export const HOST_APP_A = "app.hoteldellago.test";
export const HOST_LANDING_A = "hoteldellago.test";
export const HOST_CARTA_A = "carta.hoteldellago.test";
export const HOST_APP_B = "app.panaderialospinos.test";
export const HOST_LANDING_B = "panaderialospinos.test";

export type PuertaFalsa = Readonly<{
  resolucion: ResolucionDeHost;
  consultarHost: (
    host: string,
    superficie: "APP" | "LANDING" | "CARTA",
  ) => ReturnType<ResolucionDeHost["porHost"]>;
  leerMarca: (marcaId: string) => Promise<MarcaPublica | null>;
  /** Cuántas veces se consultó la base (por host y superficie) y se leyó una marca. */
  consultas: string[];
  lecturasDeMarca: string[];
  /** Mientras sea `true`, toda consulta falla como una base caída. */
  baseCaida: { valor: boolean };
}>;

export function crearPuertaFalsa(): PuertaFalsa {
  const consultas: string[] = [];
  const lecturasDeMarca: string[] = [];
  const baseCaida = { valor: false };
  const resolucion: ResolucionDeHost = {
    porHost(host, superficie) {
      consultas.push(`${host}|${superficie}`);
      if (baseCaida.valor) {
        return Promise.resolve(
          err({ tipo: "Inesperado", sqlstate: null, mensaje: "base caída" } as const),
        );
      }
      const normalizado = normalizarHost(host);
      if (!normalizado.ok) return Promise.resolve(ok(null));
      const fila = DOMINIOS.find(
        ([h, s, , estado]) => h === normalizado.valor && s === superficie && estado === "ACTIVO",
      );
      if (fila === undefined) return Promise.resolve(ok(null));
      const resuelto: HostResuelto = {
        host: fila[0],
        superficie: fila[1],
        duenio: { tipo: "MARCA", marcaId: fila[2].id },
        marcaId: fila[2].id,
      };
      return Promise.resolve(ok(resuelto));
    },
  };
  return {
    resolucion,
    consultarHost: (host, superficie) => resolucion.porHost(host, superficie),
    leerMarca(marcaId) {
      lecturasDeMarca.push(marcaId);
      const marca = [MARCA_A, MARCA_B].find((m) => m.id === marcaId);
      return Promise.resolve(marca === undefined ? null : marca.publica);
    },
    consultas,
    lecturasDeMarca,
    baseCaida,
  };
}
