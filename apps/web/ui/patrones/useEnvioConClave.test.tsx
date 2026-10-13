import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { Boton } from "../componentes/Boton";
import {
  restaurarConexion,
  simularConexion,
  tocar,
  violacionesDeAccesibilidad,
} from "../pruebas/ayudas";
import { FranjaSinConexion } from "./FranjaSinConexion";
import { RegionDeEstado } from "./RegionDeEstado";
import { useEnvioConClave, type RespuestaDeEnvio } from "./useEnvioConClave";

afterEach(restaurarConexion);

/**
 * Un servidor idempotente por clave, como el de verdad ([VEN] §B.7): la misma clave devuelve el mismo
 * resultado y aplica el efecto UNA vez. Puede «procesar y que el cliente no se entere» (P-11): aplica el
 * efecto y después la respuesta no llega.
 */
function servidorFalso() {
  const efectos = new Set<string>();
  const pedidos: string[] = [];
  const estado = { respuestasPerdidas: 0, demoraMs: 0, rechazar: false };
  return {
    pedidos,
    efectos,
    estado,
    async enviar(clave: string): Promise<RespuestaDeEnvio<string, string>> {
      pedidos.push(clave);
      if (estado.demoraMs > 0) await new Promise((r) => setTimeout(r, estado.demoraMs));
      if (estado.rechazar) return { ok: false, rechazo: "TICKET_YA_COBRADO" };
      efectos.add(clave);
      if (estado.respuestasPerdidas > 0) {
        estado.respuestasPerdidas--;
        throw new TypeError("Failed to fetch");
      }
      return { ok: true, valor: `registrada-${clave.slice(0, 4)}` };
    },
  };
}

function Cobro({
  servidor,
  nuevaClave,
  espera = 25,
  automaticas = 3,
}: {
  servidor: ReturnType<typeof servidorFalso>;
  nuevaClave?: () => string;
  espera?: number;
  automaticas?: number;
}) {
  const envio = useEnvioConClave<string, string>({
    enviar: (clave) => servidor.enviar(clave),
    textos: { sinConexion: "No se puede enviar sin conexión.", verificando: "Verificando…" },
    esperaEntreVerificacionesMs: espera,
    verificacionesAutomaticas: automaticas,
    ...(nuevaClave === undefined ? {} : { nuevaClave }),
  });
  const texto =
    envio.estado.tipo === "incierto"
      ? "Verificando si se registró…"
      : envio.estado.tipo === "hecho"
        ? `Listo: ${envio.estado.valor}`
        : envio.estado.tipo === "rechazado"
          ? `Rechazado: ${envio.estado.rechazo}`
          : "";
  return (
    <>
      <FranjaSinConexion texto="Sin conexión." />
      <Boton
        alTocar={envio.enviar}
        deshabilitado={envio.bloqueado}
        enviando={envio.enCurso}
        textoEnviando="Enviando…"
        motivo={envio.motivoQueNoPuede}
      >
        Cobrar
      </Boton>
      <Boton variante="secundaria" alTocar={envio.enviar}>
        Reintentar
      </Boton>
      <RegionDeEstado>{texto}</RegionDeEstado>
    </>
  );
}

const cobrar = () => page.getByRole("button", { name: "Cobrar" });
const reintentar = () => page.getByRole("button", { name: "Reintentar" });
const estado = () => page.getByRole("status");
/** Espera a que la región de estado diga algo que cumpla el patrón (el matcher de texto es exacto). */
const dice = (patron: RegExp) =>
  vi.waitFor(() => expect(estado().element().textContent).toMatch(patron), { timeout: 3000 });

describe("useEnvioConClave: un solo efecto", () => {
  it("camino feliz: una clave, un pedido, un efecto", async () => {
    const servidor = servidorFalso();
    await render(<Cobro servidor={servidor} />);
    tocar(cobrar());
    await dice(/Listo: registrada-/);
    expect(servidor.pedidos).toHaveLength(1);
    expect(servidor.efectos.size).toBe(1);
  });

  it("dos toques rápidos son un solo envío", async () => {
    const servidor = servidorFalso();
    servidor.estado.demoraMs = 40;
    await render(<Cobro servidor={servidor} />);
    // Tres toques en el mismo instante.
    tocar(cobrar());
    tocar(cobrar());
    tocar(cobrar());
    await dice(/Listo:/);
    expect(servidor.pedidos).toHaveLength(1);
    expect(servidor.efectos.size).toBe(1);
  });

  it("P-11: el servidor procesó y el cliente no se enteró → «Verificando…», reintento con LA MISMA clave y un solo efecto", async () => {
    const servidor = servidorFalso();
    servidor.estado.respuestasPerdidas = 1;
    await render(<Cobro servidor={servidor} espera={150} />);
    tocar(cobrar());
    await expect.element(estado()).toHaveTextContent("Verificando si se registró…");
    // Mientras no se sabe, no se puede empezar otro intento: el botón queda deshabilitado con su motivo.
    await expect.element(cobrar()).toBeDisabled();
    await expect.element(cobrar()).toHaveAccessibleDescription("Verificando…");
    expect(await violacionesDeAccesibilidad()).toEqual([]);

    await dice(/Listo: registrada-/);
    expect(servidor.pedidos).toHaveLength(2);
    expect(servidor.pedidos[1]).toBe(servidor.pedidos[0]);
    expect(servidor.efectos.size).toBe(1);
  });

  it("varias respuestas perdidas seguidas: siempre la misma clave; agotadas las verificaciones queda a mano, y reintentar usa esa clave", async () => {
    const servidor = servidorFalso();
    servidor.estado.respuestasPerdidas = 99;
    await render(<Cobro servidor={servidor} espera={10} automaticas={2} />);
    tocar(cobrar());
    await esperarHasta(() => servidor.pedidos.length === 3);
    // Pasada la última verificación automática no insiste más.
    await new Promise((r) => setTimeout(r, 120));
    expect(servidor.pedidos).toHaveLength(3);
    expect(new Set(servidor.pedidos).size).toBe(1);
    await expect.element(estado()).toHaveTextContent("Verificando si se registró…");

    servidor.estado.respuestasPerdidas = 0;
    tocar(reintentar());
    await dice(/Listo:/);
    expect(new Set(servidor.pedidos).size).toBe(1);
    expect(servidor.pedidos).toHaveLength(4);
    expect(servidor.efectos.size).toBe(1);
  });

  it("con la respuesta definitiva el intento termina: el próximo envío usa otra clave", async () => {
    const servidor = servidorFalso();
    await render(<Cobro servidor={servidor} />);
    tocar(cobrar());
    await dice(/Listo:/);
    await expect.element(cobrar()).toBeEnabled();
    tocar(cobrar());
    await esperarHasta(() => servidor.pedidos.length === 2);
    expect(servidor.pedidos[1]).not.toBe(servidor.pedidos[0]);
    expect(servidor.efectos.size).toBe(2);
  });

  it("un rechazo de negocio también termina el intento: se corrige y se reenvía con otra clave", async () => {
    const servidor = servidorFalso();
    servidor.estado.rechazar = true;
    await render(<Cobro servidor={servidor} />);
    tocar(cobrar());
    await expect.element(estado()).toHaveTextContent("Rechazado: TICKET_YA_COBRADO");
    servidor.estado.rechazar = false;
    tocar(cobrar());
    await dice(/Listo:/);
    expect(servidor.pedidos[1]).not.toBe(servidor.pedidos[0]);
  });

  it("la clave nueva por defecto es un UUID, distinto en cada intento", async () => {
    const servidor = servidorFalso();
    await render(<Cobro servidor={servidor} />);
    tocar(cobrar());
    await dice(/Listo:/);
    tocar(cobrar());
    await esperarHasta(() => servidor.pedidos.length === 2);
    for (const clave of servidor.pedidos) {
      expect(clave).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
    expect(servidor.pedidos[0]).not.toBe(servidor.pedidos[1]);
  });

  it("la clave la genera quien la pide al hook: una vez por intento, no en cada reintento", async () => {
    const servidor = servidorFalso();
    servidor.estado.respuestasPerdidas = 2;
    let generadas = 0;
    await render(
      <Cobro servidor={servidor} nuevaClave={() => `clave-${++generadas}`} espera={10} />,
    );
    tocar(cobrar());
    await dice(/Listo:/);
    expect(generadas).toBe(1);
    expect(servidor.pedidos).toEqual(["clave-1", "clave-1", "clave-1"]);
  });
});

describe("useEnvioConClave: sin conexión", () => {
  it("la franja es persistente y el botón queda deshabilitado con el motivo; no se manda nada", async () => {
    const servidor = servidorFalso();
    await render(<Cobro servidor={servidor} />);
    simularConexion(false);
    await expect.element(page.getByText("Sin conexión.")).toBeVisible();
    await expect.element(cobrar()).toBeDisabled();
    await expect.element(cobrar()).toHaveAccessibleDescription("No se puede enviar sin conexión.");
    await expect.element(page.getByText("No se puede enviar sin conexión.")).toBeVisible();
    // Un toque forzado tampoco manda nada.
    tocar(reintentar());
    expect(servidor.pedidos).toHaveLength(0);
    expect(await violacionesDeAccesibilidad()).toEqual([]);

    simularConexion(true);
    await expect.element(cobrar()).toBeEnabled();
    tocar(cobrar());
    await dice(/Listo:/);
    expect(servidor.pedidos).toHaveLength(1);
  });

  it("con el resultado incierto y sin red no se insiste; al volver, verifica con la misma clave", async () => {
    const servidor = servidorFalso();
    servidor.estado.respuestasPerdidas = 1;
    await render(<Cobro servidor={servidor} espera={80} />);
    tocar(cobrar());
    await expect.element(estado()).toHaveTextContent("Verificando si se registró…");
    simularConexion(false);
    await new Promise((r) => setTimeout(r, 300));
    expect(servidor.pedidos).toHaveLength(1);
    simularConexion(true);
    await dice(/Listo:/);
    expect(servidor.pedidos).toHaveLength(2);
    expect(servidor.pedidos[1]).toBe(servidor.pedidos[0]);
    expect(servidor.efectos.size).toBe(1);
  });
});

/** Espera hasta que se cumpla una condición (sondeo corto). */
async function esperarHasta(condicion: () => boolean, tope = 3000): Promise<void> {
  const inicio = Date.now();
  while (!condicion()) {
    if (Date.now() - inicio > tope) throw new Error("la condición no se cumplió a tiempo");
    await new Promise((r) => setTimeout(r, 10));
  }
}
