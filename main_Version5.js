// Apify SDK - toolkit for building Apify Actors (Read more at https://docs.apify.com/sdk/js/)
import { Actor } from 'apify';
// Crawlee - web scraping and browser automation library (Read more at https://crawlee.dev)
import { CheerioCrawler, Dataset, KeyValueStore } from 'crawlee';

// The init() call configures the Actor for its environment. It's recommended to start every Actor with an init()
await Actor.init();

// Structure of input is defined in input_schema.json
const { 
    startUrls = [
        'https://www.hermes.com/us/en/search/?q=handbags',
        'https://www.rolex.com/en-us/watches'
    ], 
    maxRequestsPerCrawl = 150,
    monitoredBrands = ['Hermès', 'Rolex', 'Louis Vuitton'],
    monitoredProducts = ['Handbags', 'Watches', 'Jewelry', 'Accessories'],
    stockAlertThreshold = 5,
    priceRange = [1000, 50000],
    enableNotifications = true,
    notificationEmail = 'alerts@example.com'
} = (await Actor.getInput()) ?? {};

// Proxy configuration to rotate IP addresses and prevent blocking
const proxyConfiguration = await Actor.createProxyConfiguration();

// Store to keep track of previous inventory
const kvStore = await KeyValueStore.open();
const previousInventory = (await kvStore.getValue('previousInventory')) || {};

// Track inventory changes
const stockAlerts = [];
const priceChanges = [];

const log = Actor.getLogger();

const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxRequestsPerCrawl,
    async requestHandler({ request, $, log }) {
        log.info('Processing luxury goods page:', { url: request.loadedUrl });

        try {
            // Determine which retailer we're scraping
            const isHermes = request.loadedUrl.includes('hermes.com');
            const isRolex = request.loadedUrl.includes('rolex.com');
            const retailer = isHermes ? 'Hermès' : isRolex ? 'Rolex' : 'Luxury Retailer';

            // Extract products based on retailer
            if (isHermes) {
                scrapeHermesProducts($, log, retailer);
            } else if (isRolex) {
                scrapeRolexProducts($, log, retailer);
            } else {
                scrapeGenericLuxuryProducts($, log, retailer);
            }
        } catch (error) {
            log.error('Error processing page:', { 
                url: request.loadedUrl,
                error: error.message 
            });
        }
    },
    
    errorHandler: async ({ request, error, log }) => {
        log.warning('Request failed:', { 
            url: request.loadedUrl,
            error: error.message 
        });
    },
});

async function scrapeHermesProducts($, log, retailer) {
    $('div[data-testid="product-card"], div.product-item').each((index, element) => {
        const $product = $(element);
        
        const productName = $product.find('h2, .product-name, [data-testid="product-name"]').text().trim() || 'N/A';
        const priceText = $product.find('.price, [data-testid="product-price"]').text().trim() || 'N/A';
        const price = parsePrice(priceText);
        const productUrl = $product.find('a').attr('href') || 'N/A';
        const fullUrl = productUrl !== 'N/A' ? `https://www.hermes.com${productUrl}` : 'N/A';
        
        const stockText = $product.find('[data-testid="stock"], .availability, .stock-status').text().toLowerCase() || '';
        const isAvailable = !stockText.includes('out of stock') && !stockText.includes('unavailable');
        const stockQuantity = extractStockQuantity(stockText);
        
        const color = $product.find('.color-variant, [data-testid="color"]').text().trim() || 'N/A';
        const size = $product.find('.size-variant, [data-testid="size"]').text().trim() || 'N/A';

        if (!productName || productName === 'N/A' || !isProductInMonitoredCategories(productName)) return;
        if (price < priceRange[0] || price > priceRange[1]) return;

        processProductData({
            productName,
            brand: retailer,
            category: extractCategory(productName),
            price,
            productUrl: fullUrl,
            stockQuantity,
            isAvailable,
            color,
            size,
            retailer,
            log
        });
    });
}

async function scrapeRolexProducts($, log, retailer) {
    $('div.product-tile, div[data-model], article.product').each((index, element) => {
        const $product = $(element);
        
        const productName = $product.find('h3, .product-title, [data-testid="product-title"]').text().trim() || 'N/A';
        const priceText = $product.find('.price, [data-testid="price"], .product-price').text().trim() || 'N/A';
        const price = parsePrice(priceText);
        const productUrl = $product.find('a.product-link, a[href*="/watches/"]').attr('href') || 'N/A';
        const fullUrl = productUrl !== 'N/A' ? `https://www.rolex.com${productUrl}` : 'N/A';
        
        const stockText = $product.find('[data-testid="availability"], .availability, .stock').text().toLowerCase() || '';
        const isAvailable = !stockText.includes('out of stock') && !stockText.includes('unavailable');
        const stockQuantity = extractStockQuantity(stockText);
        
        const reference = $product.find('.reference-number, [data-testid="reference"]').text().trim() || 'N/A';
        const material = $product.find('.material, [data-testid="material"]').text().trim() || 'N/A';

        if (!productName || productName === 'N/A') return;
        if (price < priceRange[0] || price > priceRange[1]) return;

        processProductData({
            productName,
            brand: retailer,
            category: 'Watches',
            price,
            productUrl: fullUrl,
            stockQuantity,
            isAvailable,
            reference,
            material,
            retailer,
            log
        });
    });
}

async function scrapeGenericLuxuryProducts($, log, retailer) {
    $('div[class*="product"], article[class*="product"], li[class*="product"]').each((index, element) => {
        const $product = $(element);
        
        const productName = $product.find('h2, h3, [class*="title"]').text().trim() || 'N/A';
        const priceText = $product.find('[class*="price"]').text().trim() || 'N/A';
        const price = parsePrice(priceText);
        const productUrl = $product.find('a').first().attr('href') || 'N/A';
        
        const stockText = $product.find('[class*="stock"], [class*="availability"]').text().toLowerCase() || '';
        const isAvailable = !stockText.includes('out of stock');
        const stockQuantity = extractStockQuantity(stockText);

        if (!productName || productName === 'N/A' || !isProductInMonitoredCategories(productName)) return;
        if (price < priceRange[0] || price > priceRange[1]) return;

        processProductData({
            productName,
            brand: retailer,
            category: extractCategory(productName),
            price,
            productUrl,
            stockQuantity,
            isAvailable,
            retailer,
            log
        });
    });
}

async function processProductData(data) {
    const { productName, brand, category, price, productUrl, stockQuantity, isAvailable, retailer, log } = data;
    
    const productKey = `${brand}-${productName}`.toLowerCase();
    const currentTimestamp = new Date().toISOString();

    // Check for stock changes
    if (previousInventory[productKey]) {
        const previous = previousInventory[productKey];
        
        // Stock level change
        if (previous.stockQuantity !== stockQuantity) {
            const stockChange = stockQuantity - previous.stockQuantity;
            const alertType = stockChange < 0 ? 'STOCK_DECREASE' : 'STOCK_INCREASE';
            
            if (Math.abs(stockChange) > 0 || stockQuantity <= stockAlertThreshold) {
                stockAlerts.push({
                    productName,
                    brand,
                    previousStock: previous.stockQuantity,
                    currentStock: stockQuantity,
                    stockChange,
                    alertType,
                    productUrl,
                    timestamp: currentTimestamp
                });

                log.info(`Stock alert: ${productName}`, {
                    previous: previous.stockQuantity,
                    current: stockQuantity,
                    change: stockChange
                });
            }
        }

        // Price change
        if (previous.price !== price) {
            const priceChange = ((price - previous.price) / previous.price) * 100;
            
            priceChanges.push({
                productName,
                brand,
                currentPrice: `$${price.toFixed(2)}`,
                previousPrice: `$${previous.price.toFixed(2)}`,
                priceChange: parseFloat(priceChange.toFixed(2)),
                currency: 'USD',
                productUrl,
                timestamp: currentTimestamp
            });

            log.info(`Price change: ${productName}`, {
                previous: `$${previous.price.toFixed(2)}`,
                current: `$${price.toFixed(2)}`,
                changePercent: priceChange.toFixed(2)
            });
        }

        // Availability change
        if (previous.isAvailable !== isAvailable) {
            const alertType = isAvailable ? 'NOW_IN_STOCK' : 'OUT_OF_STOCK';
            
            stockAlerts.push({
                productName,
                brand,
                previousStock: previous.isAvailable ? 'Available' : 'Out of Stock',
                currentStock: isAvailable ? 'Available' : 'Out of Stock',
                stockChange: isAvailable ? 1 : -1,
                alertType,
                productUrl,
                timestamp: currentTimestamp
            });

            log.info(`Availability alert: ${productName}`, { 
                newStatus: isAvailable ? 'In Stock' : 'Out of Stock' 
            });
        }
    }

    // Update inventory record
    previousInventory[productKey] = {
        productName,
        brand,
        price,
        stockQuantity,
        isAvailable,
        lastUpdated: currentTimestamp
    };

    // Push overview data
    await Dataset.pushData({
        productName,
        brand,
        category,
        price: `$${price.toFixed(2)}`,
        stockStatus: stockQuantity > stockAlertThreshold ? 'Adequate' : 'Low Stock',
        availability: isAvailable ? 'In Stock' : 'Out of Stock',
        lastUpdated: currentTimestamp
    });
}

// Helper function to parse price from text
function parsePrice(priceText) {
    const match = priceText.match(/[\$€£]?\s*([\d,]+\.?\d*)/);
    if (match) {
        return parseFloat(match[1].replace(/,/g, ''));
    }
    return 0;
}

// Helper function to extract stock quantity
function extractStockQuantity(stockText) {
    if (stockText.includes('out of stock')) return 0;
    const match = stockText.match(/(\d+)\s*(?:in stock|items?|units?|available)/i);
    return match ? parseInt(match[1]) : 1;
}

// Helper function to check if product is in monitored categories
function isProductInMonitoredCategories(productName) {
    const lowerName = productName.toLowerCase();
    return monitoredProducts.some(category => lowerName.includes(category.toLowerCase()));
}

// Helper function to extract product category
function extractCategory(productName) {
    const lowerName = productName.toLowerCase();
    if (lowerName.includes('handbag') || lowerName.includes('bag')) return 'Handbags';
    if (lowerName.includes('watch')) return 'Watches';
    if (lowerName.includes('jewelry') || lowerName.includes('ring') || lowerName.includes('bracelet')) return 'Jewelry';
    if (lowerName.includes('scarf') || lowerName.includes('belt') || lowerName.includes('shoe')) return 'Accessories';
    return 'Other';
}

await crawler.run(startUrls);

// Push stock alerts to dataset
for (const alert of stockAlerts) {
    await Dataset.pushData(alert);
}

// Push price changes to dataset
for (const change of priceChanges) {
    await Dataset.pushData(change);
}

// Save updated inventory for next run
await kvStore.setValue('previousInventory', previousInventory);

log.info('Monitoring completed', {
    stockAlertsCount: stockAlerts.length,
    priceChangesCount: priceChanges.length,
    productsTracked: Object.keys(previousInventory).length
});

// Gracefully exit the Actor process. It's recommended to quit all Actors with an exit()
await Actor.exit();