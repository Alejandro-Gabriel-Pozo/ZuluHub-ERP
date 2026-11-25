-- 0096_lectura_publica_de_las_cartas_de_la_empresa_del_host: la política que deja al rol público listar las cartas EN LÍNEA de UNA empresa (P3 del plan de dominio propio, M-E2).
-- Para qué: la raíz de la carta en el host dedicado de una empresa (`carta.<dominio del cliente>/`) redirige a la única carta en línea o lista las que hay. Hoy el rol público
-- (`pedernal_publico`) ve una carta SOLO por su código (`carta_publica_publico_leer`, 0043: `codigo = app.codigo_de_carta`), así que no hay forma de preguntar «qué cartas tiene esta empresa».
--
-- Qué abre, y cómo queda cerrado (denegar por defecto):
--  * UNA política nueva de SOLO LECTURA sobre `carta_publica`: `estado = 'EN_LINEA' AND empresa_id::text = current_setting('app.empresa_del_host', true)`. La variable `app.empresa_del_host`
--    la fija la lectura pública dentro de su transacción (`set_config(…, true)`), a partir del DUEÑO del host que la puerta ya resolvió (nunca un dato del navegador); si no se fijó,
--    `current_setting(…, true)` da NULL, no es igual a nada y NINGUNA fila se ve (falla cerrado). La comparación es por texto (no convierte la variable a uuid): un valor mal formado no da un
--    error ni una fila, da cero filas. Solo `EN_LINEA`: una carta fuera de línea no se lista ni se ve.
--  * NINGÚN privilegio nuevo: las columnas que el rol público ya tiene sobre `carta_publica` (0043: id, empresa_id, sucursal_id, codigo, nombre, rubro, lugar, mensaje_de_portada, estado; 0077: modelo,
--    cara, color_propio y los datos del logo) son las mismas; el listado solo usa `codigo`, `nombre`, `rubro` y `lugar` (lo acota la consulta, no la política). Ni quién creó la carta, ni cuándo, ni la versión.
--  * NINGUNA otra tabla se abre: sucursal, producto, precios, etc. siguen visibles solo por `app.codigo_de_carta`. Que una carta listada realmente se SIRVA (sucursal abierta, empresa que opera,
--    plan con el módulo de la carta y la perilla `vidriera_por_qr`) lo decide el código, que confirma cada candidata con la lectura por código de siempre antes de listarla.
--  * Sin DELETE, UPDATE ni INSERT; sin funciones; sin SECURITY DEFINER. La política existente por código no se toca (es permisiva: las dos se suman; ver abajo qué ve cada camino).
--
-- Qué ve cada camino con esta política: con `app.codigo_de_carta` fijado y sin `app.empresa_del_host`, exactamente lo de antes (una carta por código). Con `app.empresa_del_host` fijado y sin
-- código, las cartas EN_LINEA de esa empresa y nada más. Con las dos fijadas, la unión (nadie las fija juntas: son lecturas distintas).
--
-- Reglas que cumple: ADITIVA (una política nueva; nada se modifica ni se quita); COMPATIBLE HACIA ATRÁS: el código viejo no la usa y sigue igual; el código nuevo sin la política recibe lista vacía (la raíz
-- muestra la 404 neutra). Orden de aplicación: primero esta migración (`migrar.yml`, con aprobación del dueño), después el código. RLS de `carta_publica` ya ENABLE y FORCE (0043).
--
-- Su reversión es un script aparte: `migraciones/reversiones/0096_revertir_lectura_publica_de_las_cartas_de_la_empresa_del_host.sql` (sin pérdida de datos: solo quita la política).
-- DEPENDE de 0043 (carta_publica y el rol público); se comprueba al empezar.

DO $$
BEGIN
  IF to_regclass('public.carta_publica') IS NULL THEN
    RAISE EXCEPTION 'esta migración requiere 0043_carta_publica aplicada antes (falta carta_publica)' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pedernal_publico') THEN
    RAISE EXCEPTION 'esta migración requiere el rol pedernal_publico (0007)' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'carta_publica' AND policyname = 'carta_publica_publico_leer_de_la_empresa_del_host'
  ) THEN
    RAISE EXCEPTION 'la política carta_publica_publico_leer_de_la_empresa_del_host ya existe (alguien la creó a mano); hay que revisarla antes de migrar' USING ERRCODE = '55000';
  END IF;
END
$$;

CREATE POLICY carta_publica_publico_leer_de_la_empresa_del_host ON carta_publica FOR SELECT TO pedernal_publico
  USING (estado = 'EN_LINEA' AND empresa_id::text = current_setting('app.empresa_del_host', true));
