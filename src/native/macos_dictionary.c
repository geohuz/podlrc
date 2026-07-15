#include <CoreServices/CoreServices.h>
#include <dlfcn.h>
#include <stdlib.h>

typedef CFArrayRef (*DCSGetActiveDictionariesFn)(void);
typedef CFArrayRef (*DCSCopyRecordsForSearchStringFn)(
    DCSDictionaryRef, CFStringRef, void*, void*);
typedef CFStringRef (*DCSRecordCopyDataFn)(CFTypeRef, long);

static char* copy_utf8(CFStringRef string) {
    if (string == NULL) return NULL;

    CFIndex size = CFStringGetMaximumSizeForEncoding(
        CFStringGetLength(string), kCFStringEncodingUTF8) + 1;
    char* result = (char*)malloc((size_t)size);
    if (result == NULL || !CFStringGetCString(
            string, result, size, kCFStringEncodingUTF8)) {
        free(result);
        return NULL;
    }
    return result;
}

static CFStringRef copy_markup_definition(CFStringRef word) {
    DCSGetActiveDictionariesFn get_dictionaries =
        (DCSGetActiveDictionariesFn)dlsym(
            RTLD_DEFAULT, "DCSGetActiveDictionaries");
    DCSCopyRecordsForSearchStringFn copy_records =
        (DCSCopyRecordsForSearchStringFn)dlsym(
            RTLD_DEFAULT, "DCSCopyRecordsForSearchString");
    DCSRecordCopyDataFn copy_data = (DCSRecordCopyDataFn)dlsym(
        RTLD_DEFAULT, "DCSRecordCopyData");
    if (get_dictionaries == NULL || copy_records == NULL ||
            copy_data == NULL) {
        return NULL;
    }

    CFArrayRef dictionaries = get_dictionaries();
    CFIndex dictionary_count = dictionaries == NULL
        ? 0 : CFArrayGetCount(dictionaries);
    for (CFIndex i = 0; i < dictionary_count; i++) {
        DCSDictionaryRef dictionary = (DCSDictionaryRef)
            CFArrayGetValueAtIndex(dictionaries, i);
        CFArrayRef records = copy_records(dictionary, word, NULL, NULL);
        if (records != NULL && CFArrayGetCount(records) > 0) {
            CFTypeRef record = CFArrayGetValueAtIndex(records, 0);
            CFStringRef definition = copy_data(record, 0);
            CFRelease(records);
            if (definition != NULL) return definition;
        } else if (records != NULL) {
            CFRelease(records);
        }
    }
    return NULL;
}

char* pod_dictionary_lookup(const char* word) {
    if (word == NULL || word[0] == '\0') return NULL;

    CFStringRef text = CFStringCreateWithCString(
        kCFAllocatorDefault, word, kCFStringEncodingUTF8);
    if (text == NULL) return NULL;

    CFStringRef definition = copy_markup_definition(text);
    if (definition == NULL) {
        CFRange range = DCSGetTermRangeInString(NULL, text, 0);
        if (range.location != kCFNotFound) {
            definition = DCSCopyTextDefinition(NULL, text, range);
        }
    }
    CFRelease(text);
    if (definition == NULL) return NULL;

    char* result = copy_utf8(definition);
    CFRelease(definition);
    return result;
}

void pod_dictionary_free(char* text) {
    free(text);
}
