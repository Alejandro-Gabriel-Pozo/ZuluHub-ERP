import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearMundoDeMarca } from "../integracion/marcas-apoyo";
import {
  crearInvitacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  incluirEmpresa,
} from "../integracion/fixtures-identidad";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * Invitar, reenviar y revocar (tramo U2) de punta a punta en la app REAL construida, con un navegador real y una base real. El gerente entra a «Usuarios» y:
 *  R1 toca «Invitar», escribe un email y envía: vuelve a la lista y la invitación figura en «Invitaciones» (esa es la confirmación) y queda UN trabajo de mail;
 *  R2 toca «Enviar invitación» dos veces seguidas: queda UNA invitación y UN trabajo de mail;
 *  R3 abre la invitación y toca «Reenviar»: va a la ficha de la NUEVA, la anterior queda revocada y reemplazada;
 *  R4 toca «Revocar»: la invitación desaparece de la lista;
 *  R5 desde dos pestañas invita al MISMO email a la vez: una crea y la otra avisa «Ya había una invitación pendiente para ese email»; queda UNA fila.
 * Además: el email de alguien que ya es parte dice «Ya es parte de la empresa»; la ficha de una invitación de otra empresa dice lo mismo que una inexistente; y sin violaciones graves de accesibilidad.
 * Lo que esta prueba ve y las de componentes y las de integración no: las acciones de servidor en el navegador (cifrado del id ligado con `.bind`, la navegación tras el éxito) y la lista que se vuelve a leer.
 */
const base = inject("baseDePruebas");
const CELULAR = { width: 390, height: 844 } as const;
const GENERICO = "Esta acción no está permitida";
const DIA = 86_400_000;

describe.skipIf(base === null)("recorrido de invitar, reenviar y revocar usuarios", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;
  let deOtraEmpresa = "";

  const consulta = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[],
  ) => (await mundo.mundo.dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[]) =>
    Number((await consulta<{ n: string }>(texto, parametros))[0]?.n);
  const invitacionesDe = (email: string) =>
    consulta<{ id: string; estado: string; reemplazada_por: string | null }>(
      "select i.id, i.estado, i.reemplazada_por from invitacion i join invitacion_empresa ie on ie.invitacion_id = i.id where ie.empresa_id = $1 and ie.email = $2 order by i.emitida_en, i.id",
      [mundo.empresa, email],
    );
  const trabajosDe = (email: string) =>
    contar(
      "select count(*) as n from trabajo t where t.empresa_id = $1 and t.tipo = 'enviar_invitacion' and (t.datos->>'invitacionId') in (select i.id::text from invitacion i join invitacion_empresa ie on ie.invitacion_id = i.id where ie.email = $2)",
      [mundo.empresa, email],
    );

  const ir = async (ruta: string, en: Page = pagina) => {
    const respuesta = await en.goto(`${mundo.url}${ruta}`);
    await en.waitForLoadState("networkidle");
    return respuesta;
  };
  const sinViolacionesDeAxe = async () => expect(await violacionesGravesDeAxe(pagina)).toEqual([]);
  const pantallaLimpia = () => expect(vigilante.tomar()).toEqual([]);

  /** Abre «Invitar» desde la lista tocando el enlace y escribe el email (el rol queda en Empleado). */
  async function abrirInvitar(email: string, en: Page = pagina) {
    await ir("/cuenta/usuarios", en);
    await en.getByRole("link", { name: "Invitar", exact: true }).click();
    await en.waitForURL(/\/cuenta\/usuarios\/invitar$/);
    await en.waitForLoadState("networkidle");
    await en.getByLabel("Email").fill(email);
  }

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base);
    const c = mundo.mundo.dueno;
    const marcos = await crearPersonaDeBase(c, "marcos@lacteos.test");
    await crearMembresiaDeBase(c, mundo.empresa, marcos.id, "OPERADOR");
    // Otra empresa (otro tenant) con una invitación: su ficha no tiene que verse desde acá.
    const otra = await crearMundoDeMarca(c, { marca: mundo.mundo.marcaA });
    const invAjena = await crearInvitacionDeBase(c, {
      tenant: otra.tenant,
      email: "invitada@otra-empresa.test",
      venceEn: new Date(Date.now() + 3 * DIA),
    });
    await incluirEmpresa(c, invAjena, otra.empresa, "OPERADOR");
    deOtraEmpresa = invAjena.id;

    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
    await contexto.addCookies([...mundo.cookies]);
    pagina = await contexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
  });
  afterAll(async () => {
    await navegador?.close();
    await mundo?.cerrar();
  });

  it("R1: el gerente toca «Invitar», escribe un email y envía: vuelve a la lista con la invitación y sale un solo mail", async () => {
    const email = "julia@lacteos.test";
    await abrirInvitar(email);
    await pagina.getByRole("heading", { name: "Invitar" }).waitFor();
    await pagina.getByRole("button", { name: "Enviar invitación" }).waitFor();
    await sinViolacionesDeAxe();

    await pagina.getByRole("button", { name: "Enviar invitación" }).click();
    await pagina.waitForURL(/\/cuenta\/usuarios$/);
    await pagina.waitForLoadState("networkidle");
    await pagina.getByRole("heading", { name: "Invitaciones" }).waitFor();
    await pagina.getByText(email).waitFor();
    await pagina.getByText("Empleado · Vence el", { exact: false }).first().waitFor();

    expect(await invitacionesDe(email)).toHaveLength(1);
    expect(await trabajosDe(email)).toBe(1);
    pantallaLimpia();
  });

  it("R2: dos toques seguidos en «Enviar invitación» dejan UNA invitación y UN mail", async () => {
    const email = "doble@lacteos.test";
    await abrirInvitar(email);
    const enviar = pagina.getByRole("button", { name: "Enviar invitación" });
    await enviar.dblclick();
    await pagina.waitForURL(/\/cuenta\/usuarios$/, { timeout: 30_000 });
    await pagina.waitForLoadState("networkidle");
    await pagina.getByText(email).waitFor();

    expect(await invitacionesDe(email)).toHaveLength(1);
    expect(await trabajosDe(email)).toBe(1);
    expect(await pagina.getByText(email).count()).toBe(1);
    pantallaLimpia();
  });

  it("R3: «Reenviar» va a la ficha de la invitación NUEVA; la anterior queda revocada y reemplazada, y salen dos mails en total (uno por invitación)", async () => {
    const email = "julia@lacteos.test";
    const [origen] = await invitacionesDe(email);
    await ir("/cuenta/usuarios");
    await pagina.getByRole("link", { name: new RegExp(email) }).click();
    await pagina.waitForURL(/\/cuenta\/usuarios\/invitaciones\/[0-9a-f-]{36}$/);
    await pagina.waitForLoadState("networkidle");
    await pagina.getByRole("heading", { name: email }).waitFor();
    await pagina.getByText("Pendiente").first().waitFor();
    await pagina.getByText("Vence el", { exact: false }).waitFor();
    await sinViolacionesDeAxe();
    expect(pagina.url()).toContain(origen?.id);

    await pagina.getByRole("button", { name: "Reenviar" }).click();
    await pagina.waitForURL((url) => !url.pathname.endsWith(origen?.id ?? ""), { timeout: 30_000 });
    await pagina.waitForLoadState("networkidle");
    await pagina.getByRole("heading", { name: email }).waitFor();

    const todas = await invitacionesDe(email);
    expect(todas).toHaveLength(2);
    const nueva = todas.find((i) => i.estado === "PENDIENTE");
    expect(pagina.url()).toContain(nueva?.id);
    expect(todas.find((i) => i.id === origen?.id)).toMatchObject({
      estado: "REVOCADA",
      reemplazada_por: nueva?.id,
    });
    expect(await trabajosDe(email)).toBe(2);
    pantallaLimpia();
  });

  it("R4: «Revocar» la saca de la lista y deja la invitación revocada", async () => {
    const email = "julia@lacteos.test";
    await ir("/cuenta/usuarios");
    await pagina.getByRole("link", { name: new RegExp(email) }).click();
    await pagina.waitForURL(/\/cuenta\/usuarios\/invitaciones\/[0-9a-f-]{36}$/);
    await pagina.waitForLoadState("networkidle");

    await pagina.getByRole("button", { name: "Revocar" }).click();
    await pagina.waitForURL(/\/cuenta\/usuarios$/, { timeout: 30_000 });
    await pagina.waitForLoadState("networkidle");
    await pagina.getByRole("heading", { name: "Usuarios" }).waitFor();
    expect(await pagina.getByText(email).count()).toBe(0);
    expect((await invitacionesDe(email)).filter((i) => i.estado === "PENDIENTE")).toHaveLength(0);
    pantallaLimpia();
  });

  it("R5: dos pestañas invitando al MISMO email a la vez: una crea y la otra avisa «Ya había una invitación pendiente para ese email»; queda UNA", async () => {
    const email = "carrera@lacteos.test";
    const otra = await contexto.newPage();
    const vigilanteDeLaOtra = await vigilar(otra, HOST_DEL_RECORRIDO);
    await abrirInvitar(email, pagina);
    await abrirInvitar(email, otra);

    await Promise.all([
      pagina.getByRole("button", { name: "Enviar invitación" }).click(),
      otra.getByRole("button", { name: "Enviar invitación" }).click(),
    ]);
    const aviso = "Ya había una invitación pendiente para ese email";
    await Promise.race([
      pagina.getByText(aviso).waitFor({ timeout: 30_000 }),
      otra.getByText(aviso).waitFor({ timeout: 30_000 }),
    ]);
    // La que creó navega a la lista; la otra se queda con el aviso.
    await Promise.any([
      pagina.waitForURL(/\/cuenta\/usuarios$/, { timeout: 30_000 }),
      otra.waitForURL(/\/cuenta\/usuarios$/, { timeout: 30_000 }),
    ]);

    expect(await invitacionesDe(email)).toHaveLength(1);
    expect(await trabajosDe(email)).toBe(1);
    const conAviso = [
      await pagina.getByText(aviso).count(),
      await otra.getByText(aviso).count(),
    ].reduce((a, b) => a + b, 0);
    expect(conAviso).toBe(1);
    expect(vigilanteDeLaOtra.tomar()).toEqual([]);
    await otra.close();
    pantallaLimpia();
  });

  it("invitar al email de alguien que ya es parte dice «Ya es parte de la empresa» y no escribe", async () => {
    await abrirInvitar("marcos@lacteos.test");
    await pagina.getByRole("button", { name: "Enviar invitación" }).click();
    await pagina.getByText("Ya es parte de la empresa").waitFor();
    expect(await invitacionesDe("marcos@lacteos.test")).toHaveLength(0);
    expect(pagina.url()).toMatch(/\/cuenta\/usuarios\/invitar$/);
    await sinViolacionesDeAxe();
  });

  it("la ficha de una invitación de OTRA empresa o de una que no existe dice lo mismo: el genérico, sin botones", async () => {
    for (const id of [deOtraEmpresa, "0b0b0b0b-1111-4222-8333-4444444444ee", "no-es-un-id"]) {
      await ir(`/cuenta/usuarios/invitaciones/${id}`);
      await pagina.getByText(GENERICO).first().waitFor();
      expect(await pagina.getByText("invitada@otra-empresa.test").count()).toBe(0);
      expect(await pagina.getByRole("button", { name: /Reenviar|Revocar/ }).count()).toBe(0);
    }
    pantallaLimpia();
  });
});
