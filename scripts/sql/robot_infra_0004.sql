-- ============================================================
-- Robot infrastructure migration 0004 (idempotente)
-- ============================================================
-- PROBLEMA:
--   Robot 01 escribe ext_content_es/en/fr (JSONB rico) a las tablas,
--   pero las vistas exponen ext_descripcion_es (TEXT, siempre NULL).
--   WordPress lee las vistas y recibe NULL en description_es, meta_title, etc.
--
-- SOLUCION:
--   Actualizar las 3 vistas para:
--   1. Extraer campos del JSONB content (hero → description, metaTitle, metaDescription)
--   2. Agregar publication_title (NO es nombre_desarrollo para evitar deteccion de rivales)
--   3. Exponer el JSONB completo para uso futuro del frontend
--   4. Construir array de amenidades desde columnas booleanas
--   5. Exponer ext_content_es/en/fr como content_es/en/fr (JSONB raw)
-- ============================================================

-- DROP + CREATE es necesario porque PostgreSQL no permite reordenar
-- ni renombrar columnas con CREATE OR REPLACE. Las vistas no tienen
-- datos propios, solo son definiciones — el DROP es seguro.

-- === VIEW v_developers (sin cambios grandes, solo limpieza) ===
DROP VIEW IF EXISTS real_estate_hub."v_developers";
CREATE VIEW real_estate_hub."v_developers" AS
SELECT
    id,
    legacy_id,
    nombre_desarrollador AS name,
    ext_slug_desarrollador AS slug,
    logo AS logo_url,
    sitio_web AS website,
    telefono AS phone,
    email,
    descripcion AS description_es,
    ext_descripcion_en AS description_en,
    ext_ciudad AS city,
    ext_estado AS state,
    es_verificado AS verified,
    nombre_contacto AS contact_name,
    puesto_contacto AS contact_title,
    redes_sociales AS social_media,
    calificacion AS rating,
    proyectos_activos AS active_projects,
    unidades_entregadas AS delivered_units,
    anos_experiencia AS years_experience,
    proyectos_entregados AS delivered_projects,
    created_at,
    updated_at,
    deleted_at,
    approved_at,
    approved_by,
    zoho_pipeline_status,
    -- Nuevos: flags de publicacion
    ext_publicado AS published,
    ext_destacado AS featured
FROM real_estate_hub."Propyte_desarrolladores";


-- === VIEW v_developments (PRINCIPAL — extrae contenido del JSONB) ===
DROP VIEW IF EXISTS real_estate_hub."v_developments";
CREATE VIEW real_estate_hub."v_developments" AS
SELECT
    d.id,
    d.legacy_id,
    d.ext_slug_desarrollo AS slug,
    d.nombre_desarrollo AS name,

    -- ────────────────────────────────────────────────────────────
    -- TITULO DE PUBLICACION: NO es el nombre del desarrollo
    -- Prioridad: metaTitle del content → meta_title manual → genérico tipo+ciudad
    -- ────────────────────────────────────────────────────────────
    COALESCE(
        d.ext_content_es->>'metaTitle',
        d.ext_meta_title_desarrollo,
        d.tipo_desarrollo || ' en ' || d.ciudad
    ) AS publication_title,

    d.id_desarrollador AS developer_id,
    d.tipo_desarrollo AS development_type,
    d.etapa_construccion AS stage,
    d.avance_obra_porcentaje AS construction_progress,
    d.fecha_entrega AS estimated_delivery,
    d.ext_fecha_entrega_texto AS delivery_text,
    d.unidades_totales AS total_units,
    d.unidades_disponibles AS available_units,
    d.ext_reserved_units AS reserved_units,
    d.ext_sold_units AS sold_units,
    d.fotos_desarrollo AS images,
    d.url_drive_general AS drive_url,
    d.lista_precios AS price_list_url,
    d.brochure_pdf AS brochure_url,
    d.tour_virtual_desarrollo AS virtual_tour_url,
    d.masterplan,
    d.video_desarrollo AS video_url,
    d.ext_precio_min_mxn AS price_min_mxn,
    d.ext_precio_max_mxn AS price_max_mxn,
    d.ext_moneda AS currency,
    d.ext_roi_proyectado AS roi_projected,
    d.ext_roi_renta_mensual AS roi_rental_monthly,
    d.ext_roi_apreciacion AS roi_appreciation,
    d.ext_enganche_porcentaje AS financing_down_payment,
    d.ext_meses_financiamiento AS financing_months,
    d.ext_tasa_interes AS financing_interest,

    -- ────────────────────────────────────────────────────────────
    -- CONTENIDO: extrae de JSONB anidado con fallback a columnas TEXT manuales
    -- Estructura JSONB: { hero: {h1, intro}, features: {body}, location: {body},
    --   lifestyle: {body}, metaTitle: string, metaDescription: string, faq: [...] }
    -- ────────────────────────────────────────────────────────────
    COALESCE(d.ext_descripcion_es, d.ext_content_es->'hero'->>'intro')
        AS description_es,
    COALESCE(d.ext_descripcion_en, d.ext_content_en->'hero'->>'intro')
        AS description_en,
    COALESCE(d.ext_descripcion_corta_es, LEFT(d.ext_content_es->'hero'->>'intro', 250))
        AS description_short_es,
    COALESCE(d.ext_descripcion_corta_en, LEFT(d.ext_content_en->'hero'->>'intro', 250))
        AS description_short_en,
    COALESCE(d.ext_meta_title_desarrollo, d.ext_content_es->>'metaTitle')
        AS meta_title,
    COALESCE(d.ext_meta_description_desarrollo, d.ext_content_es->>'metaDescription')
        AS meta_description,

    -- H1 heading (del hero section)
    d.ext_content_es->'hero'->>'h1' AS content_h1_es,
    d.ext_content_en->'hero'->>'h1' AS content_h1_en,

    -- Secciones de contenido individuales (extraer body del objeto anidado)
    d.ext_content_es->'features'->>'body' AS content_features_es,
    d.ext_content_es->'location'->>'body' AS content_location_es,
    d.ext_content_es->'lifestyle'->>'body' AS content_lifestyle_es,
    d.ext_content_en->'features'->>'body' AS content_features_en,
    d.ext_content_en->'location'->>'body' AS content_location_en,
    d.ext_content_en->'lifestyle'->>'body' AS content_lifestyle_en,

    -- FAQ como JSONB array (para schema.org y acordeones)
    d.ext_content_es->'faq' AS faq_es,
    d.ext_content_en->'faq' AS faq_en,

    -- JSONB completo (para uso avanzado del frontend)
    d.ext_content_es AS content_es,
    d.ext_content_en AS content_en,
    d.ext_content_fr AS content_fr,

    d.ext_keywords AS keywords,
    d.ext_destacado AS featured,
    d.ext_publicado AS published,
    d.pais AS country,
    d.estado AS state,
    d.municipio AS municipality,
    d.ciudad AS city,
    d.colonia AS neighborhood,
    d.calle AS address,
    d.codigo_postal AS zip_code,
    d.latitud AS lat,
    d.longitud AS lng,
    d.zona AS zone,
    d.link_maps AS maps_url,
    d.playa_distancia AS beach_distance,
    d.aeropuerto_nombre AS airport_name,
    d.aeropuerto_distancia AS airport_distance,
    d.puntos_interes AS points_of_interest,
    d.ext_crm_relationship AS crm_relationship,
    d.ext_commission_rate AS commission_rate,
    d.ext_property_types AS property_types,
    d.ext_usage AS usage,
    d.ext_badge AS badge,
    d.ext_plaza AS plaza,
    d.ext_contacto_nombre AS contact_name,
    d.ext_contacto_telefono AS contact_phone,
    d.ext_detection_source AS detection_source,
    d.ext_source_url AS source_url,
    d.ext_detected_at AS detected_at,

    -- ────────────────────────────────────────────────────────────
    -- AMENIDADES: array construido desde columnas booleanas
    -- WordPress necesita esto como array para propyte_amenities
    -- ────────────────────────────────────────────────────────────
    ARRAY_REMOVE(ARRAY[
        CASE WHEN d.amenidad_alberca_privada     THEN 'Alberca Privada' END,
        CASE WHEN d.amenidad_alberca_comunitaria  THEN 'Alberca Comunitaria' END,
        CASE WHEN d.amenidad_gym                  THEN 'Gimnasio' END,
        CASE WHEN d.amenidad_salon_eventos        THEN 'Salón de Eventos' END,
        CASE WHEN d.amenidad_coworking            THEN 'Coworking' END,
        CASE WHEN d.amenidad_rooftop              THEN 'Rooftop' END,
        CASE WHEN d.amenidad_fire_pit             THEN 'Fire Pit' END,
        CASE WHEN d.amenidad_yoga                 THEN 'Área de Yoga' END,
        CASE WHEN d.amenidad_jardin_privado       THEN 'Jardín Privado' END,
        CASE WHEN d.amenidad_jardin_comunitario   THEN 'Jardín Comunitario' END,
        CASE WHEN d.amenidad_spa                  THEN 'Spa' END,
        CASE WHEN d.amenidad_restaurante          THEN 'Restaurante' END,
        CASE WHEN d.amenidad_concierge            THEN 'Concierge' END,
        CASE WHEN d.amenidad_seguridad_24h        THEN 'Seguridad 24h' END,
        CASE WHEN d.amenidad_cctv                 THEN 'CCTV' END,
        CASE WHEN d.amenidad_acceso_controlado    THEN 'Acceso Controlado' END,
        CASE WHEN d.amenidad_lobby                THEN 'Lobby' END,
        CASE WHEN d.amenidad_elevador             THEN 'Elevador' END,
        CASE WHEN d.amenidad_bodega               THEN 'Bodega' END,
        CASE WHEN d.amenidad_pet_zone             THEN 'Pet Zone' END,
        CASE WHEN d.amenidad_cancha               THEN 'Cancha' END,
        CASE WHEN d.amenidad_area_ninos           THEN 'Área de Niños' END
    ], NULL) AS amenities,

    d.created_at,
    d.updated_at,
    d.deleted_at,
    dev.nombre_desarrollador AS developer_name,
    dev.ext_slug_desarrollador AS developer_slug,
    d.approved_at,
    d.approved_by,
    d.zoho_pipeline_status

FROM real_estate_hub."Propyte_desarrollos" d
LEFT JOIN real_estate_hub."Propyte_desarrolladores" dev ON d.id_desarrollador = dev.id;


-- Re-grant permissions lost after DROP+CREATE
GRANT SELECT ON real_estate_hub."v_developers" TO anon, authenticated;
GRANT SELECT ON real_estate_hub."v_developments" TO anon, authenticated;

-- === VIEW v_units (extrae contenido del JSONB) ===
DROP VIEW IF EXISTS real_estate_hub."v_units";
CREATE VIEW real_estate_hub."v_units" AS
SELECT
    u.id,
    u.legacy_id,
    u.slug_unidad AS slug,

    -- ────────────────────────────────────────────────────────────
    -- TITULO: metaTitle del content → titulo manual → genérico tipo+ciudad
    -- ────────────────────────────────────────────────────────────
    COALESCE(
        u.ext_content_es->>'metaTitle',
        u.titulo_unidad,
        CONCAT_WS(' — ',
            NULLIF(d.nombre_desarrollo, ''),
            CONCAT_WS(' ',
                COALESCE(u.subtipo_unidad, u.tipo_unidad, 'Unidad'),
                u.ext_numero_unidad
            )
        )
    ) AS title,

    u.subtitulo_unidad AS subtitle,

    -- ────────────────────────────────────────────────────────────
    -- CONTENIDO: extrae de JSONB anidado con fallback a columnas TEXT
    -- ────────────────────────────────────────────────────────────
    COALESCE(u.descripcion_corta_unidad, LEFT(u.ext_content_es->'hero'->>'intro', 250))
        AS description_short,
    COALESCE(u.descripcion_larga_unidad, u.ext_content_es->'hero'->>'intro')
        AS description_es,
    COALESCE(u.ext_descripcion_en, u.ext_content_en->'hero'->>'intro')
        AS description_en,

    -- H1 heading
    u.ext_content_es->'hero'->>'h1' AS content_h1_es,

    -- Secciones individuales de contenido (extraer body del objeto anidado)
    u.ext_content_es->'features'->>'body' AS content_features_es,
    u.ext_content_es->'location'->>'body' AS content_location_es,
    u.ext_content_es->'lifestyle'->>'body' AS content_lifestyle_es,

    -- FAQ
    u.ext_content_es->'faq' AS faq_es,
    u.ext_content_en->'faq' AS faq_en,

    -- JSONB completo
    u.ext_content_es AS content_es,
    u.ext_content_en AS content_en,
    u.ext_content_fr AS content_fr,

    -- SEO meta
    COALESCE(u.meta_title_unidad, u.ext_content_es->>'metaTitle') AS meta_title,
    COALESCE(u.meta_description_unidad, u.ext_content_es->>'metaDescription') AS meta_description,
    u.keywords_unidad AS keywords,

    u.id_desarrollo AS development_id,
    u.id_desarrollador AS developer_id,
    u.id_agente AS agent_id,
    u.ext_numero_unidad AS unit_number,
    u.tipo_unidad AS unit_type,
    u.subtipo_unidad AS unit_subtype,
    u.ext_tipologia AS typology,
    u.estado_unidad AS status,
    u.es_nueva_unidad AS is_new,
    u.es_destacada_unidad AS featured,
    u.es_preventa AS is_presale,
    u.ext_publicado AS published,
    u.recamaras AS bedrooms,
    u.banos_completos AS bathrooms,
    u.medios_banos AS half_baths,
    u.superficie_total_m2 AS area_m2,
    u.superficie_construida_m2 AS built_area_m2,
    u.superficie_terreno_m2 AS lot_area_m2,
    u.niveles_unidad AS floors,
    u.piso_numero AS floor,
    u.estacionamientos AS parking_spots,
    u.orientacion AS orientation,
    u.vista_unidad AS view_type,
    u.amueblado AS furnished,
    u.equipado AS equipped,
    u.mascotas_permitidas AS pets_allowed,
    u.ext_tiene_alberca AS has_pool,
    u.precio_mxn AS price_mxn,
    u.precio_usd AS price_usd,
    u.precio_m2_mxn AS price_per_m2_mxn,
    u.precio_m2_usd AS price_per_m2_usd,
    u.moneda_principal AS currency,
    u.precio_desde AS price_from,
    u.enganche_porcentaje AS down_payment_pct,
    u.ext_enganche_mxn AS down_payment_mxn,
    u.ext_mensualidad_mxn AS monthly_payment_mxn,
    u.ext_precio_venta AS sale_price,
    u.roi_anual_porcentaje AS roi_annual,
    u.renta_mensual_estimada_mxn AS estimated_rent_mxn,
    u.apreciacion_anual_porcentaje AS appreciation_annual,
    u.tipo_rendimiento AS yield_type,
    u.plataformas_renta AS rental_platforms,
    u.fotos_unidad AS images,
    u.foto_portada_unidad AS cover_image,
    u.video_recorrido_unidad AS video_url,
    u.tour_virtual_unidad AS virtual_tour_url,
    u.plano_unidad AS floor_plan_url,
    u.calificacion_unidad AS rating,
    u.numero_resenas_unidad AS review_count,
    u.ext_reserved_by_contact_id AS reserved_by_contact_id,
    u.ext_reserved_at AS reserved_at,
    u.ext_sold_at AS sold_at,
    u.created_at,
    u.updated_at,
    u.deleted_at,
    d.nombre_desarrollo AS development_name,
    d.ext_slug_desarrollo AS development_slug,
    d.ciudad AS city,
    d.estado AS state,
    d.zona AS zone,
    dev.nombre_desarrollador AS developer_name,
    u.approved_at,
    u.approved_by,
    u.zoho_pipeline_status

FROM real_estate_hub."Propyte_unidades" u
LEFT JOIN real_estate_hub."Propyte_desarrollos" d ON u.id_desarrollo = d.id
LEFT JOIN real_estate_hub."Propyte_desarrolladores" dev ON u.id_desarrollador = dev.id;

GRANT SELECT ON real_estate_hub."v_units" TO anon, authenticated;
