// ==============================================
// CONFIGURAÇÃO INICIAL
// ==============================================

// 1. Carregar os municípios
var municipios = ee.FeatureCollection('projects/ee-paulaflorestal/assets/Muni')
    .filter(ee.Filter.inList('CD_MUN', ['2905206', '2919504', '2921906', '2513604', '2931806']));

// 2. Definir classes de uso do solo do MapBiomas Coleção 9
var classesUsoSolo = [
    { name: 'Floresta', value: 1 },
    { name: 'Formação Florestal', value: 3 },
    { name: 'Formação Savânica', value: 4 },
    { name: 'Mangue', value: 5 },
    { name: 'Floresta Alagável', value: 6 },
    { name: 'Restinga Arbórea', value: 49 },
    { name: 'Vegetação Herbácea e Arbustiva', value: 10 },
    { name: 'Campo Alagado e Área Pantanosa', value: 11 },
    { name: 'Formação Campestre', value: 12 },
    { name: 'Apicum', value: 32 },
    { name: 'Afloramento Rochoso', value: 29 },
    { name: 'Restinga Herbácea', value: 50 },
    { name: 'Agropecuária', value: 14 },
    { name: 'Pastagem', value: 15 },
    { name: 'Agricultura', value: 18 },
    { name: 'Lavoura Temporária', value: 19 },
    { name: 'Soja', value: 39 },
    { name: 'Cana', value: 20 },
    { name: 'Arroz', value: 40 },
    { name: 'Algodão (beta)', value: 62 },
    { name: 'Outras Lavouras Temporárias', value: 41 },
    { name: 'Lavoura Perene', value: 36 },
    { name: 'Café', value: 46 },
    { name: 'Citrus', value: 47 },
    { name: 'Dendê', value: 35 },
    { name: 'Outras Lavouras Perenes', value: 48 },
    { name: 'Silvicultura', value: 9 },
    { name: 'Mosaico de Usos', value: 21 },
    { name: 'Área não Vegetada', value: 22 },
    { name: 'Praia, Dune e Areal', value: 23 },
    { name: 'Área Urbanizada', value: 24 },
    { name: 'Mineração', value: 30 },
    { name: 'Outras Áreas não Vegetadas', value: 25 },
    { name: 'Corpo Dágua', value: 26 },
    { name: 'Rio, Lago e Oceano', value: 33 },
    { name: 'Aquicultura', value: 31 },
    { name: 'Não observado', value: 27 }
];

// ==============================================
// FUNÇÕES AUXILIARES
// ==============================================

// Função para calcular SAVI
var calculateSAVI = function(image) {
    var sensor = ee.String(image.get('SPACECRAFT_ID'));
    
    var nirBand = ee.Algorithms.If(
        sensor.equals('LANDSAT_5'), 'SR_B4',
        ee.Algorithms.If(
            sensor.equals('LANDSAT_7'), 'SR_B4',
            'SR_B5' // Landsat 8/9
        )
    );
    
    var redBand = ee.Algorithms.If(
        sensor.equals('LANDSAT_5'), 'SR_B3',
        ee.Algorithms.If(
            sensor.equals('LANDSAT_7'), 'SR_B3',
            'SR_B4' // Landsat 8/9
        )
    );
    
    var nir = image.select([nirBand]);
    var red = image.select([redBand]);
    var L = 0.5;
    
    var savi = nir.subtract(red)
        .multiply(1 + L)
        .divide(nir.add(red).add(L))
        .rename('SAVI');
    
    return image.addBands(savi);
};

// Função para calcular LAI a partir do SAVI
var calculateLAI = function(image) {
    var savi = image.select(['SAVI']);
    
    var lai = savi.expression(
        '(-log((0.69 - SAVI) / 0.59)) / 0.91', {
            'SAVI': savi
        }
    ).rename('LAI')
    .max(0).min(8);
    
    return image.addBands(lai);
};

// Função para calcular Kc baseado no LAI
var calculateKc = function(image) {
    var lai = image.select(['LAI']);
    
    var kc = ee.Image().expression(
        '(LAI <= 3) ? (LAI / 3) : 1', {
            'LAI': lai
        }
    ).rename('Kc')
    .max(0).min(1);
    
    return image.addBands(kc);
};

// Função para obter coleção Landsat com filtro de nuvens (50%)
var getLandsatCollection = function(year, month) {
    year = ee.Number(year).toInt();
    month = ee.Number(month).toInt();
    
    var startDate = ee.Date.fromYMD(year, month, 1);
    var endDate = startDate.advance(1, 'month');

    // Landsat 5 (1984-2011)
    var l5 = ee.ImageCollection('LANDSAT/LT05/C02/T1_L2')
        .filterDate(startDate, endDate)
        .filter(ee.Filter.lt('CLOUD_COVER', 50));

    // Landsat 7 (1999-presente)
    var l7 = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
        .filterDate(startDate, endDate)
        .filter(ee.Filter.lt('CLOUD_COVER', 50));

    // Landsat 8 (2013-presente)
    var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
        .filterDate(startDate, endDate)
        .filter(ee.Filter.lt('CLOUD_COVER', 50));

    // Landsat 9 (2021-presente)
    var l9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')
        .filterDate(startDate, endDate)
        .filter(ee.Filter.lt('CLOUD_COVER', 50));

    // Combinar coleções conforme ano
    var collection = ee.ImageCollection(
        year.lt(1999) ? l5 :
        year.lt(2013) ? l5.merge(l7) :
        year.lt(2021) ? l5.merge(l7).merge(l8) :
        l5.merge(l7).merge(l8).merge(l9)
    ).filterBounds(municipios);

    return collection;
};

// Função para carregar dados do MapBiomas
var getMapBiomasData = function(year) {
    year = ee.Number(year).toInt();
    return ee.Image('projects/mapbiomas-public/assets/brazil/lulc/collection9/mapbiomas_collection90_integration_v1')
        .select(ee.String('classification_').cat(ee.String(year)));
};

// ==============================================
// PROCESSAMENTO PRINCIPAL
// ==============================================

// Função para obter imagens de meses adjacentes (fallback)
var getFallbackCollection = function(year, month) {
    year = ee.Number(year).toInt();
    month = ee.Number(month).toInt();
    
    // Mês anterior
    var prevMonth = month.subtract(1);
    var prevYear = ee.Algorithms.If(prevMonth.lt(1), year.subtract(1), year);
    prevMonth = ee.Algorithms.If(prevMonth.lt(1), ee.Number(12), prevMonth);
    var prevCollection = getLandsatCollection(prevYear, prevMonth);
    
    // Próximo mês
    var nextMonth = month.add(1);
    var nextYear = ee.Algorithms.If(nextMonth.gt(12), year.add(1), year);
    nextMonth = ee.Algorithms.If(nextMonth.gt(12), ee.Number(1), nextMonth);
    var nextCollection = getLandsatCollection(nextYear, nextMonth);
    
    // Combinar coleções (mês atual + fallback)
    return getLandsatCollection(year, month)
        .merge(prevCollection)
        .merge(nextCollection)
        .filterBounds(municipios);
};

// Função para processar um mês
var processMonth = function(year, month, landUse) {
    var landsatCol = getFallbackCollection(year, month);
    var isEmpty = landsatCol.size().eq(0);
    
    // Imagem vazia como fallback
    var emptyImage = ee.Image().float();
    
    // Calcular Kc médio mensal
    var monthlyKc = ee.Algorithms.If({
        condition: isEmpty,
        trueCase: emptyImage,
        falseCase: landsatCol
            .map(calculateSAVI)
            .map(calculateLAI)
            .map(calculateKc)
            .select('Kc')
            .reduce(ee.Reducer.percentile([50]))
            .clip(municipios)
    });
    
    // Calcular estatísticas por classe de uso do solo
    var results = ee.Algorithms.If({
        condition: isEmpty,
        trueCase: ee.FeatureCollection([]),
        falseCase: ee.FeatureCollection(classesUsoSolo.map(function(classe) {
            var kcToMask = ee.Image(monthlyKc);
            var maskedKc = kcToMask.updateMask(landUse.eq(classe.value));
            
            var stats = maskedKc.reduceRegions({
                collection: municipios,
                reducer: ee.Reducer.mean().combine(ee.Reducer.count(), null, true),
                scale: 30,
                crs: 'EPSG:4326'
            });
            
            return stats.map(function(feat) {
                return feat
                    .set('year', year)
                    .set('month', month)
                    .set('lucode', classe.value)
                    .set('class_name', classe.name)
                    .set('municipio', feat.get('NM_MUN'));
            });
        })).flatten()
    });
    
    return { 
        kc: ee.Image(monthlyKc), // Garante que seja uma imagem
        stats: results 
    };
};

// ==============================================
// PROCESSAMENTO POR LOTE E EXPORTAÇÃO
// ==============================================

var startYear = 1985;
var endYear = 2023;
var batchSize = 3; // Processar 3 anos por lote

for (var y = startYear; y <= endYear; y += batchSize) {
    var batchStart = y;
    var batchEnd = Math.min(y + batchSize - 1, endYear);
    
    var batchResults = ee.FeatureCollection(
        ee.List.sequence(batchStart, batchEnd).map(function(year) {
            year = ee.Number(year).toInt();
            var landUse = getMapBiomasData(year);
            
            return ee.FeatureCollection(
                ee.List.sequence(1, 12).map(function(month) {
                    return processMonth(year, month, landUse).stats;
                })
            ).flatten();
        })
    ).flatten();
    
    Export.table.toDrive({
        collection: batchResults,
        description: 'Kc_Results_' + batchStart + '_' + batchEnd,
        fileFormat: 'CSV',
        selectors: ['CD_MUN', 'NM_MUN', 'year', 'month', 'lucode', 'class_name', 'mean', 'count'],
        folder: 'GEE_Kc_Results'
    });
    
    print('Exportando lote: ' + batchStart + '-' + batchEnd);
}

// ==============================================
// VISUALIZAÇÃO DE EXEMPLO
// ==============================================

Map.centerObject(municipios, 8);
Map.addLayer(municipios, { color: 'blue', fillColor: '00000000' }, 'Municípios');

var exampleYear = 2020;
var exampleMonth = 6;
var exampleLandUse = getMapBiomasData(exampleYear);
var exampleKc = processMonth(exampleYear, exampleMonth, exampleLandUse).kc;

var kcViz = {
    min: 0,
    max: 1,
    palette: ['red', 'yellow', 'green']
};

Map.addLayer(exampleLandUse.clip(municipios), { min: 1, max: 49 }, 'Uso do Solo ' + exampleYear);
Map.addLayer(exampleKc, kcViz, 'Kc Médio ' + exampleMonth + '/' + exampleYear);

// Adicionar legenda
var legend = ui.Panel({
    style: {
        position: 'bottom-right',
        padding: '8px 15px'
    }
});

var legendTitle = ui.Label({
    value: 'Valores de Kc',
    style: {
        fontWeight: 'bold',
        fontSize: '18px',
        margin: '0 0 4px 0',
        padding: '0'
    }
});

legend.add(legendTitle);

var colorBar = ui.Thumbnail({
    image: ee.Image.pixelLonLat().select(0),
    params: {
        color: ['red', 'yellow', 'green'],
        min: 0,
        max: 1,
        size: '150px'
    },
    style: { stretch: 'horizontal', margin: '0px 8px' }
});

legend.add(colorBar);
Map.add(legend);

print('Processamento concluído. Verifique as tarefas de exportação no GEE.');
