import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import {
  DIA,
  NADA_PERMITIDO,
  TODO_PERMITIDO,
  enPagina,
  legibleYTocable,
  modeloDe,
  puerta,
  servidorSimulado,
  ventana,
} from "./ayudas-de-pruebas";
import { PantallaDelCierre } from "./PantallaDelCierre.cliente";

/**
 * «Cierre del día» en Chromium (maqueta aceptada, tres pasos): cada estado accesible y legible a 390 y 1280, un paso por vez con puntos 1 · 2 · 3, «Impide cerrar» arriba, «Reconocer» que solo
 * MARCA (nada se manda hasta cerrar), «Cerrar el día» con la huella y lo reconocido, «Corregir medio», declarar y «Conforme general», y lo cerrado en solo lectura. Las acciones del servidor van simuladas.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const servidor = servidorSimulado();
const GENERICO = "Esta acción no está permitida";

beforeEach(() => {
  router.refresh.mockReset();
  for (const accion of Object.values(servidor.acciones))
    accion.mockReset().mockResolvedValue({ ok: true, dato: {} });
});
afterEach(async () => {
  await page.viewport(390, 844);
});

const pantalla = (modelo = modeloDe()) =>
  enPagina(<PantallaDelCierre modelo={modelo} servidor={servidor.acciones} />);
const boton = (nombre: string | RegExp) => page.getByRole("button", { name: nombre });
// El botón de avance lleva el nombre del paso al que va: no hay «Siguiente» (decisión del dueño, 21/11/2026).
const siguiente = () => boton(/^(Conciliación por medio|Hay que reconocer)/);
const irAlPaso = async (n: 2 | 3) => {
  await siguiente().click();
  if (n === 3) await siguiente().click();
};
const generico = (
  codigo:
    "CIERRE_ACCION_NO_PERMITIDA" | "CIERRE_CONTROLES_CAMBIARON" = "CIERRE_ACCION_NO_PERMITIDA",
): Respuesta<unknown> => ({
  ok: false,
  error: errorDeCodigo(codigo),
});

const reconocerEn = async (rotulo: string, observacion = "") => {
  await page
    .getByRole("group", { name: rotulo })
    .getByRole("button", { name: "Reconocer" })
    .click();
  if (observacion !== "")
    await page.getByRole("dialog").getByLabelText("Observación (opcional)").fill(observacion);
  await page.getByRole("dialog").getByRole("button", { name: "Reconocer" }).click();
};

describe("accesibilidad y medidas, en cada paso", () => {
  const estados = [
    {
      nombre: "jornada abierta",
      ir: () => Promise.resolve(),
      modelo: modeloDe({ estado: "ABIERTA", conciliacion: null, cobros: null, medios: [] }),
    },
    { nombre: "paso 1: cobros", ir: () => Promise.resolve(), modelo: modeloDe() },
    { nombre: "paso 2: conciliación por medio", ir: () => irAlPaso(2), modelo: modeloDe() },
    { nombre: "paso 3: hay que reconocer", ir: () => irAlPaso(3), modelo: modeloDe() },
    {
      nombre: "jornada cerrada",
      ir: () => Promise.resolve(),
      modelo: modeloDe({
        estado: "CERRADA",
        cerradaPor: "lucia@ejemplo.com",
        cerradaEn: "2026-11-10T01:30:00.000Z",
      }),
    },
  ];
  it.each(estados.flatMap((e) => [390, 1280].map((ancho) => ({ ...e, ancho }))))(
    "$nombre a $ancho px: sin violaciones como página, legible y tocable, sin desborde lateral",
    async ({ ir, modelo, ancho }) => {
      await ventana(ancho);
      await render(pantalla(modelo));
      await ir();
      expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
      legibleYTocable();
    },
  );
});

describe("jornada abierta", () => {
  const abierta = (cambios = {}, acciones = TODO_PERMITIDO) =>
    modeloDe(
      { estado: "ABIERTA", conciliacion: null, cobros: null, medios: [], ...cambios },
      acciones,
    );

  it("muestra la jornada con su fecha y estado y UNA sola acción, «Empezar el cierre»; sin controles ni pasos", async () => {
    await render(pantalla(abierta()));
    await expect.element(page.getByText("Jornada 09/11/2026")).toBeVisible();
    await expect.element(page.getByText("Abierta", { exact: true })).toBeVisible();
    await expect.element(boton("Empezar el cierre")).toBeVisible();
    expect(page.getByRole("button").elements()).toHaveLength(1);
    expect(document.body.textContent).not.toContain("Impide cerrar");
    expect(document.querySelector("ol")).toBeNull();
  });

  it("«Empezar el cierre» manda la jornada, el doble toque es un solo envío y al terminar vuelve a leer el día", async () => {
    const abierta_ = puerta();
    servidor.empezar.mockReturnValue(abierta_.espera);
    await render(pantalla(abierta()));
    const b = boton("Empezar el cierre");
    tocar(b);
    tocar(b);
    tocar(b);
    await expect.element(boton("Enviando…")).toBeVisible();
    abierta_.soltar({ ok: true, dato: { yaEstabaEnAuditoria: false } });
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(servidor.empezar).toHaveBeenCalledTimes(1);
    expect(servidor.empezar).toHaveBeenCalledWith({ fechaDeNegocio: "2026-11-09" });
  });

  it("si el servidor rechaza, muestra el genérico y, ahora sí, lo que impide cerrar (arriba, «Impide cerrar»)", async () => {
    servidor.empezar.mockResolvedValue(generico());
    await render(pantalla(abierta()));
    expect(document.body.textContent).not.toContain("Impide cerrar");
    await boton("Empezar el cierre").click();
    await expect.element(page.getByText(GENERICO)).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Impide cerrar" })).toBeVisible();
    await expect.element(page.getByText("Cuentas abiertas sin cobrar · 2")).toBeVisible();
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    // Lo que impide va solo, sin los que hay que reconocer ni los que informan.
    expect(document.body.textContent).not.toContain("Hay que reconocer");
  });

  it("si el que rechaza lo deja pasar de nuevo, el aviso se va", async () => {
    servidor.empezar.mockResolvedValueOnce(generico());
    await render(pantalla(abierta()));
    await boton("Empezar el cierre").click();
    await expect.element(page.getByText(GENERICO)).toBeVisible();
    await boton("Empezar el cierre").click();
    await vi.waitFor(() => expect(servidor.empezar).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(document.body.textContent).not.toContain(GENERICO));
  });

  it("sin el permiso, el botón sale apagado (el servidor decide igual al enviar)", async () => {
    await render(pantalla(abierta({}, NADA_PERMITIDO)));
    await expect.element(boton("Empezar el cierre")).toBeDisabled();
  });
});

describe("en cierre: un paso por vez", () => {
  it("empieza en el paso 1 con «Cobros»: cada cobro con su importe, quién lo registró y su medio; los puntos dicen en cuál estás; lo que impide va arriba", async () => {
    await render(pantalla());
    await expect.element(page.getByText("En cierre", { exact: true })).toBeVisible();
    const puntos = document.querySelectorAll("ol > li");
    expect([...puntos].map((p) => p.getAttribute("aria-current"))).toEqual(["step", null, null]);
    await expect.element(page.getByRole("heading", { name: "Cobros" })).toBeVisible();
    await expect.element(page.getByText("$ 18.400,00")).toBeVisible();
    await expect.element(page.getByText("Tarjeta de crédito · Posnet 1")).toBeVisible();
    await expect.element(page.getByText("· lucia@ejemplo.com")).toBeVisible();
    // «Impide cerrar» arriba de todo, antes del paso.
    const encabezados = [...document.querySelectorAll("h2")].map((h) => h.textContent);
    expect(encabezados).toEqual(["Impide cerrar", "Cobros"]);
    expect(page.getByRole("button", { name: "Corregir medio" }).elements()).toHaveLength(2);
    await expect.element(siguiente()).toBeVisible();
    await expect.element(boton("Cancelar cierre")).toBeVisible();
    expect(document.body.textContent).not.toContain("Conforme general");
    expect(document.body.textContent).not.toContain("Cerrar el día");
  });

  it("un solo botón lleno por pantalla: el de avance (primario); «Cancelar cierre» es secundario", async () => {
    await render(pantalla());
    const primario = (n: string | RegExp) =>
      boton(n).element().closest("[data-variante]")?.getAttribute("data-variante") ??
      boton(n).element().getAttribute("data-variante");
    expect(primario(/^Conciliación por medio/)).toBe("primaria");
    expect(primario("Cancelar cierre")).toBe("secundaria");
  });

  it("el botón de avance lleva el nombre del paso al que va («Conciliación por medio», «Hay que reconocer»); la flecha «‹» retrocede; el título del paso recibe el foco", async () => {
    await render(pantalla());
    await expect.element(boton("Conciliación por medio")).toBeVisible();
    await siguiente().click();
    await expect
      .element(page.getByRole("heading", { name: "Conciliación por medio" }))
      .toBeVisible();
    await vi.waitFor(() =>
      expect(document.activeElement?.textContent).toBe("Conciliación por medio"),
    );
    expect(
      [...document.querySelectorAll("ol > li")].map((p) => p.getAttribute("aria-current")),
    ).toEqual([null, "step", null]);
    await expect.element(boton("Hay que reconocer")).toBeVisible();
    await siguiente().click();
    await expect.element(page.getByRole("heading", { name: "Hay que reconocer" })).toBeVisible();
    await expect.element(boton("Cerrar el día")).toBeVisible();
    expect(document.body.textContent).not.toContain("Siguiente");
    expect(document.body.textContent).not.toContain("Volver");
    await boton("Volver").click();
    await expect
      .element(page.getByRole("heading", { name: "Conciliación por medio" }))
      .toBeVisible();
    await boton("Volver").click();
    await expect.element(page.getByRole("heading", { name: "Cobros" })).toBeVisible();
    expect(document.body.textContent).not.toContain("Volver");
  });

  it("los pasos 2 y 3 siguen mostrando arriba lo que impide cerrar", async () => {
    await render(pantalla());
    await irAlPaso(2);
    expect(document.querySelector("h2")?.textContent).toBe("Impide cerrar");
    await siguiente().click();
    expect(document.querySelector("h2")?.textContent).toBe("Impide cerrar");
  });

  it("paso 2: cada medio con lo registrado, las correcciones (solo si hubo), lo declarado y la diferencia; el efectivo no se declara", async () => {
    await render(pantalla());
    await irAlPaso(2);
    await expect.element(boton("Conforme general")).toBeVisible();
    await expect.element(page.getByText("Efectivo", { exact: true })).toBeVisible();
    await expect.element(page.getByText("$ 1.250,00")).toBeVisible();
    await expect.element(page.getByText("-$ 18.400,00")).toBeVisible();
    await expect.element(page.getByText("Sin declarar")).toBeVisible();
    // Campo de importe solo para los medios que no son efectivo.
    expect(page.getByLabelText("Declarado").elements()).toHaveLength(2);
    expect(page.getByRole("button", { name: "Guardar" }).elements()).toHaveLength(2);
    // Solo el que tuvo correcciones dibuja la fila.
    expect(page.getByText("Correcciones", { exact: true }).elements()).toHaveLength(1);
  });

  it("paso 3: «Solo informa · 2» está plegado y se abre; los que impiden o hay que reconocer no", async () => {
    await render(pantalla());
    await irAlPaso(3);
    const plegable = document.querySelector("details");
    expect(plegable?.open).toBe(false);
    await expect.element(page.getByText("Solo informa · 2")).toBeVisible();
    await page.getByText("Solo informa · 2").click();
    expect(plegable?.open).toBe(true);
    await expect.element(page.getByText("Anulaciones", { exact: true })).toBeVisible();
  });
});

describe("«Reconocer» solo marca; nada se manda hasta cerrar", () => {
  it("abre el diálogo, guarda la marca con ✓ y la observación, y tocarlo de nuevo la quita; el servidor no se entera", async () => {
    await render(pantalla());
    await irAlPaso(3);
    const reconocer = page
      .getByRole("group", { name: "Diferencias de arqueo · 1" })
      .getByRole("button", { name: "Reconocer" });
    await reconocer.click();
    const dialogo = page.getByRole("dialog", { name: "Reconocer · Diferencias de arqueo" });
    await expect.element(dialogo).toBeVisible();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
    await dialogo.getByLabelText("Observación (opcional)").fill("Faltó cambio");
    await dialogo.getByRole("button", { name: "Reconocer" }).click();
    await expect
      .element(page.getByRole("button", { name: "✓ Reconocer" }))
      .toHaveAttribute("aria-pressed", "true");
    // Tocar de nuevo quita la marca, sin diálogo.
    await page.getByRole("button", { name: "✓ Reconocer" }).click();
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "✓ Reconocer" }).elements()).toHaveLength(0);
    for (const accion of Object.values(servidor.acciones)) expect(accion).not.toHaveBeenCalled();
  });

  it("«Cancelar» y Escape cierran el diálogo sin marcar y devuelven el foco", async () => {
    await render(pantalla());
    await irAlPaso(3);
    const reconocer = page.getByRole("button", { name: "Reconocer" }).first();
    await reconocer.click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "✓ Reconocer" }).elements()).toHaveLength(0);
    await reconocer.click();
    await userEvent.keyboard("{Escape}");
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
    await vi.waitFor(() => expect(document.activeElement).toBe(reconocer.element()));
  });

  it("cada control se marca por separado; la marca vale mientras el control tenga la misma cantidad y se pierde si cambia", async () => {
    const { rerender } = await render(pantalla());
    await irAlPaso(3);
    await reconocerEn("Diferencias de arqueo · 1");
    await expect
      .element(
        page
          .getByRole("group", { name: "Diferencias de arqueo · 1" })
          .getByRole("button", { name: "✓ Reconocer" }),
      )
      .toBeVisible();
    expect(
      page
        .getByRole("group", { name: "Cortesías · 3" })
        .getByRole("button", { name: "Reconocer", exact: true })
        .elements(),
    ).toHaveLength(1);
    // Llega una cortesía más: el control cambió y su marca (si la tuviera) ya no vale; la del otro sigue.
    const cambiado = modeloDe({
      controles: DIA.controles.map((c) =>
        c.clave === "caja.diferencia_de_arqueo" ? { ...c, cantidad: 2 } : c,
      ),
    });
    await rerender(pantalla(cambiado));
    await expect
      .element(
        page
          .getByRole("group", { name: "Diferencias de arqueo · 2" })
          .getByRole("button", { name: "Reconocer", exact: true }),
      )
      .toBeVisible();
  });
});

describe("«Cerrar el día»", () => {
  it("manda la jornada, la huella que se vio y SOLO lo marcado (con su observación o sin ella); el doble toque es un solo envío y al terminar vuelve a leer", async () => {
    const en = puerta();
    servidor.cerrar.mockReturnValue(en.espera);
    await render(pantalla());
    await irAlPaso(3);
    await reconocerEn("Diferencias de arqueo · 1", "Faltó cambio");
    const cerrar = boton("Cerrar el día");
    tocar(cerrar);
    tocar(cerrar);
    en.soltar({ ok: true, dato: { yaEstabaCerrada: false } });
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(servidor.cerrar).toHaveBeenCalledTimes(1);
    expect(servidor.cerrar).toHaveBeenCalledWith({
      fechaDeNegocio: "2026-11-09",
      huellaVista: "huella-del-servidor",
      reconocimientos: [
        { modulo: "caja", clave: "caja.diferencia_de_arqueo", texto: "Faltó cambio" },
      ],
    });
  });

  it("una marca sin observación viaja en blanco (el servidor la canoniza); sin marcar nada viaja una lista vacía y el servidor responde (no se replica su regla)", async () => {
    servidor.cerrar.mockResolvedValue(generico());
    await render(pantalla());
    await irAlPaso(3);
    await boton("Cerrar el día").click();
    await expect.element(page.getByText(GENERICO)).toBeVisible();
    expect(servidor.cerrar).toHaveBeenLastCalledWith({
      fechaDeNegocio: "2026-11-09",
      huellaVista: "huella-del-servidor",
      reconocimientos: [],
    });
    await reconocerEn("Cortesías · 3");
    await boton("Cerrar el día").click();
    await vi.waitFor(() => expect(servidor.cerrar).toHaveBeenCalledTimes(2));
    expect(servidor.cerrar).toHaveBeenLastCalledWith({
      fechaDeNegocio: "2026-11-09",
      huellaVista: "huella-del-servidor",
      // El cliente manda lo escrito tal cual (en blanco, vacío): el servidor lo canoniza a «sin observación».
      reconocimientos: [{ modulo: "ventas", clave: "ventas.cortesias", texto: "" }],
    });
  });

  it("si algo cambió mientras se miraba, avisa con el texto propio y vuelve a leer el día", async () => {
    servidor.cerrar.mockResolvedValue(generico("CIERRE_CONTROLES_CAMBIARON"));
    await render(pantalla());
    await irAlPaso(3);
    await boton("Cerrar el día").click();
    await expect
      .element(page.getByText("Cambió algo mientras mirabas. Revisá y volvé a cerrar"))
      .toBeVisible();
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("sin el permiso de cerrar, el botón sale apagado y «Reconocer» también", async () => {
    await render(pantalla(modeloDe({}, { ...TODO_PERMITIDO, cerrar: false })));
    await irAlPaso(3);
    await expect.element(boton("Cerrar el día")).toBeDisabled();
    for (const b of page.getByRole("button", { name: "Reconocer" }).elements())
      expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("«Cancelar cierre»", () => {
  it("manda la jornada, vuelve al paso 1 y descarta las marcas", async () => {
    await render(pantalla());
    await irAlPaso(3);
    await reconocerEn("Diferencias de arqueo · 1");
    await boton("Cancelar cierre").click();
    await vi.waitFor(() =>
      expect(servidor.cancelar).toHaveBeenCalledWith({ fechaDeNegocio: "2026-11-09" }),
    );
    await expect.element(page.getByRole("heading", { name: "Cobros" })).toBeVisible();
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    await irAlPaso(3);
    expect(page.getByRole("button", { name: "✓ Reconocer" }).elements()).toHaveLength(0);
  });

  it("si el servidor lo rechaza, queda donde estaba con el aviso", async () => {
    servidor.cancelar.mockResolvedValue(generico());
    await render(pantalla());
    await irAlPaso(2);
    await boton("Cancelar cierre").click();
    await expect.element(page.getByText(GENERICO)).toBeVisible();
    await expect
      .element(page.getByRole("heading", { name: "Conciliación por medio" }))
      .toBeVisible();
  });

  it("sin el permiso, sale apagado", async () => {
    await render(pantalla(modeloDe({}, { ...TODO_PERMITIDO, cancelar: false })));
    await expect.element(boton("Cancelar cierre")).toBeDisabled();
  });
});

describe("declarar el total y el «Conforme general» (paso 2)", () => {
  it("«Guardar» queda apagado hasta escribir un importe; manda el medio, la cuenta y el importe como texto decimal con una clave", async () => {
    await render(pantalla());
    await irAlPaso(2);
    const delDebito = page.getByRole("listitem").filter({ hasText: "Tarjeta de débito" });
    const guardar = delDebito.getByRole("button", { name: "Guardar" });
    await expect.element(guardar).toBeDisabled();
    await userEvent.type(delDebito.getByLabelText("Declarado"), "7070,5");
    await expect.element(guardar).toBeEnabled();
    await guardar.click();
    await vi.waitFor(() => expect(servidor.declarar).toHaveBeenCalledTimes(1));
    const pedido = servidor.declarar.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(pedido).toMatchObject({
      fechaDeNegocio: "2026-11-09",
      medioDePagoId: "de",
      cuentaDeCobroId: "t1",
      importe: "7070.50",
    });
    expect(String(pedido["claveDeIdempotencia"])).toMatch(/^[0-9a-f-]{36}$/);
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("un medio ya declarado precarga su total; el cero se puede declarar", async () => {
    await render(pantalla());
    await irAlPaso(2);
    const transferencia = page.getByRole("listitem").filter({ hasText: "Transferencia" });
    await expect.element(transferencia.getByLabelText("Declarado")).toHaveValue("1.800,00");
    const debito = page.getByRole("listitem").filter({ hasText: "Tarjeta de débito" });
    await userEvent.type(debito.getByLabelText("Declarado"), "0");
    await debito.getByRole("button", { name: "Guardar" }).click();
    await vi.waitFor(() => expect(servidor.declarar).toHaveBeenCalled());
    expect(servidor.declarar.mock.calls[0]?.[0]).toMatchObject({ importe: "0.00" });
  });

  it("sin el permiso de declarar, el campo y «Guardar» salen apagados, y «Conforme general» también", async () => {
    await render(pantalla(modeloDe({}, { ...TODO_PERMITIDO, declarar: false })));
    await irAlPaso(2);
    await expect.element(boton("Conforme general")).toBeDisabled();
    for (const campo of page.getByLabelText("Declarado").elements())
      expect((campo as HTMLInputElement).disabled).toBe(true);
  });

  it("«Conforme general» manda la jornada con una clave y vuelve a leer", async () => {
    await render(pantalla());
    await irAlPaso(2);
    await boton("Conforme general").click();
    await vi.waitFor(() => expect(servidor.conforme).toHaveBeenCalledTimes(1));
    const pedido = servidor.conforme.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(pedido["fechaDeNegocio"]).toBe("2026-11-09");
    expect(String(pedido["claveDeIdempotencia"])).toMatch(/^[0-9a-f-]{36}$/);
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("si el servidor rechaza una declaración o el conforme, muestra el genérico", async () => {
    servidor.conforme.mockResolvedValue(generico());
    await render(pantalla());
    await irAlPaso(2);
    await boton("Conforme general").click();
    await expect.element(page.getByText(GENERICO)).toBeVisible();
  });
});

describe("«Corregir medio» (paso 1)", () => {
  const abrir = async () => {
    await render(pantalla());
    await page
      .getByRole("listitem")
      .filter({ hasText: "$ 18.400,00" })
      .getByRole("button", { name: "Corregir medio" })
      .click();
    return page.getByRole("dialog", { name: "Corregir medio" });
  };

  it("el diálogo muestra el cobro, el «Medio correcto» (sin el vigente), la «Cuenta de cobro» con «Sin cuenta» y el «Motivo»; accesible", async () => {
    const dialogo = await abrir();
    await expect
      .element(dialogo.getByText("$ 18.400,00 · Tarjeta de crédito · Posnet 1"))
      .toBeVisible();
    const medios = [
      ...dialogo.getByLabelText("Medio correcto").element().querySelectorAll("option"),
    ].map((o) => o.textContent);
    expect(medios).toEqual(["Efectivo", "Tarjeta de débito"]);
    // El primer medio ofrecido es el efectivo, que no lleva cuenta: el selector no se dibuja.
    expect(dialogo.getByLabelText("Cuenta de cobro").elements()).toHaveLength(0);
    await expect.element(dialogo.getByLabelText("Motivo")).toBeVisible();
    expect(await violacionesDeAccesibilidad(document.body)).toEqual([]);
  });

  it("«Guardar» queda apagado sin motivo; con el medio y el motivo manda la corrección con una clave y vuelve a leer el día", async () => {
    const dialogo = await abrir();
    const guardar = dialogo.getByRole("button", { name: "Guardar" });
    await expect.element(guardar).toBeDisabled();
    await dialogo.getByLabelText("Medio correcto").selectOptions("Tarjeta de débito");
    await dialogo.getByLabelText("Motivo").fill("Se cobró con crédito y era débito");
    await expect.element(guardar).toBeEnabled();
    await guardar.click();
    await vi.waitFor(() => expect(servidor.corregir).toHaveBeenCalledTimes(1));
    const pedido = servidor.corregir.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(pedido).toMatchObject({
      cobroId: "cobro-1",
      medioDestinoId: "de",
      cuentaDestinoId: null,
      motivo: "Se cobró con crédito y era débito",
    });
    expect(String(pedido["claveDeIdempotencia"])).toMatch(/^[0-9a-f-]{36}$/);
    await vi.waitFor(() => expect(page.getByRole("dialog").elements()).toHaveLength(0));
    expect(router.refresh).toHaveBeenCalled();
  });

  it("elegir la cuenta: cambiar de medio la reinicia a «Sin cuenta»", async () => {
    const dialogo = await abrir();
    await dialogo.getByLabelText("Medio correcto").selectOptions("Tarjeta de débito");
    const cuenta = dialogo.getByLabelText("Cuenta de cobro");
    expect([...cuenta.element().querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Sin cuenta",
      "Posnet 1",
    ]);
    await cuenta.selectOptions("Posnet 1");
    await dialogo.getByLabelText("Medio correcto").selectOptions("Efectivo");
    await dialogo.getByLabelText("Medio correcto").selectOptions("Tarjeta de débito");
    expect((dialogo.getByLabelText("Cuenta de cobro").element() as HTMLSelectElement).value).toBe(
      "",
    );
    await dialogo.getByLabelText("Motivo").fill("Era débito");
    await dialogo.getByLabelText("Cuenta de cobro").selectOptions("Posnet 1");
    await dialogo.getByRole("button", { name: "Guardar" }).click();
    await vi.waitFor(() => expect(servidor.corregir).toHaveBeenCalled());
    expect(servidor.corregir.mock.calls[0]?.[0]).toMatchObject({
      medioDestinoId: "de",
      cuentaDestinoId: "t1",
    });
  });

  it("si el servidor rechaza, el aviso se ve en el diálogo y sigue abierto; «Cancelar» y Escape lo cierran sin enviar", async () => {
    servidor.corregir.mockResolvedValue(generico());
    const dialogo = await abrir();
    await dialogo.getByLabelText("Motivo").fill("Era débito");
    await dialogo.getByRole("button", { name: "Guardar" }).click();
    await expect.element(dialogo.getByText(GENERICO)).toBeVisible();
    expect(router.refresh).not.toHaveBeenCalled();
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
    await page
      .getByRole("listitem")
      .filter({ hasText: "$ 2.000,00" })
      .getByRole("button", { name: "Corregir medio" })
      .click();
    await userEvent.keyboard("{Escape}");
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
  });

  it("un cobro sin corrección posible o sin permiso sale con el botón apagado; el medio vigente no se ofrece salvo con más de una cuenta", async () => {
    const sinPermiso = modeloDe({}, { ...TODO_PERMITIDO, corregirMedio: false });
    await render(pantalla(sinPermiso));
    for (const b of page.getByRole("button", { name: "Corregir medio" }).elements())
      expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it("un cobro ya corregido muestra quién lo corrigió, cuándo y por qué", async () => {
    const primero = DIA.cobros?.cobros[0];
    if (primero === undefined) throw new Error("el día de ejemplo no tiene cobros");
    const corregido = modeloDe({
      cobros: {
        hayMas: false,
        cobros: [
          {
            ...primero,
            ultimaCorreccion: {
              por: "tomas@ejemplo.com",
              en: "2026-11-10T01:20:00.000Z",
              motivo: "Era débito",
            },
          },
        ],
      },
    });
    await render(pantalla(corregido));
    await expect
      .element(page.getByText("Corregido por tomas@ejemplo.com · 09/11/2026 22:20"))
      .toBeVisible();
    await expect.element(page.getByText("Era débito")).toBeVisible();
  });
});

describe("jornada cerrada: solo se mira", () => {
  const cerrada = () =>
    modeloDe({
      estado: "CERRADA",
      cerradaPor: "lucia@ejemplo.com",
      cerradaEn: "2026-11-10T01:30:00.000Z",
      controles: DIA.controles.map((c) =>
        c.severidad === "RECONOCIBLE"
          ? {
              ...c,
              reconocido: true,
              reconocidoPor: "tomas@ejemplo.com",
              reconocidoEn: "2026-11-10T01:30:00.000Z",
              texto: c.clave === "caja.diferencia_de_arqueo" ? "Faltó cambio" : null,
            }
          : c,
      ),
    });

  it("«Cerrada» con quién y cuándo, lo reconocido con «Reconocido por …», y la conciliación y los cobros plegados; ninguna acción", async () => {
    await render(pantalla(cerrada()));
    await expect.element(page.getByText("Cerrada", { exact: true })).toBeVisible();
    await expect.element(page.getByText("lucia@ejemplo.com · 09/11/2026 22:30")).toBeVisible();
    await expect
      .element(page.getByText("Reconocido por tomas@ejemplo.com · 09/11/2026 22:30").first())
      .toBeVisible();
    await expect.element(page.getByText("Faltó cambio")).toBeVisible();
    await expect.element(page.getByText("Conciliación por medio", { exact: true })).toBeVisible();
    for (const d of document.querySelectorAll("details")) expect(d.open).toBe(false);
    expect(page.getByRole("button").elements()).toHaveLength(0);
    expect(page.getByLabelText("Declarado").elements()).toHaveLength(0);
    expect(document.body.textContent).not.toContain("Cerrar el día");
    expect(document.querySelector("ol")).toBeNull();
  });

  it("la conciliación y los cobros se abren para mirarlos, sin campos ni botones", async () => {
    await render(pantalla(cerrada()));
    await page.getByText("Conciliación por medio", { exact: true }).click();
    await expect.element(page.getByText("$ 7.070,00")).toBeVisible();
    await page.getByText("Cobros", { exact: true }).click();
    await expect.element(page.getByText("$ 18.400,00")).toBeVisible();
    expect(page.getByRole("button").elements()).toHaveLength(0);
    expect(page.getByLabelText("Declarado").elements()).toHaveLength(0);
  });
});
