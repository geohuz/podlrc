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

static CFStringRef copy_phrase_at_offset(CFStringRef text, CFIndex offset) {
    if (text == NULL || offset < 0 || offset >= CFStringGetLength(text)) {
        return NULL;
    }

    CFRange range = DCSGetTermRangeInString(NULL, text, offset);
    if (range.location == kCFNotFound || range.length <= 0) {
        return NULL;
    }
    return CFStringCreateWithSubstring(kCFAllocatorDefault, text, range);
}

static int same_string(CFStringRef a, CFStringRef b) {
    if (a == NULL || b == NULL) return 0;
    return CFStringCompare(a, b, kCFCompareCaseInsensitive) == kCFCompareEqualTo;
}

static CFStringRef copy_markup_definition(CFStringRef word, CFStringRef phrase) {
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
        CFStringRef queries[2] = { phrase, word };
        for (int q = 0; q < 2; q++) {
            if (queries[q] == NULL) continue;
            if (q == 1 && same_string(phrase, word)) continue;

            CFArrayRef records = copy_records(dictionary, queries[q], NULL, NULL);
            if (records != NULL && CFArrayGetCount(records) > 0) {
                CFTypeRef record = CFArrayGetValueAtIndex(records, 0);
                CFStringRef definition = copy_data(record, 0);
                CFRelease(records);
                if (definition != NULL) return definition;
            } else if (records != NULL) {
                CFRelease(records);
            }
        }
    }
    return NULL;
}

char* pod_dictionary_lookup_context(
        const char* word,
        const char* context,
        long offset) {
    if (word == NULL || word[0] == '\0') return NULL;

    CFStringRef text = CFStringCreateWithCString(
        kCFAllocatorDefault, word, kCFStringEncodingUTF8);
    if (text == NULL) return NULL;

    CFStringRef context_text = NULL;
    CFStringRef phrase = NULL;
    if (context != NULL && context[0] != '\0' && offset >= 0) {
        context_text = CFStringCreateWithCString(
            kCFAllocatorDefault, context, kCFStringEncodingUTF8);
        phrase = copy_phrase_at_offset(context_text, (CFIndex)offset);
        if (phrase != NULL &&
                CFStringGetLength(phrase) < CFStringGetLength(text)) {
            CFRelease(phrase);
            phrase = NULL;
        }
    }

    CFStringRef definition = copy_markup_definition(text, phrase);
    if (definition == NULL) {
        CFRange range = DCSGetTermRangeInString(NULL, text, 0);
        if (range.location != kCFNotFound) {
            definition = DCSCopyTextDefinition(NULL, text, range);
        }
    }
    if (phrase != NULL) CFRelease(phrase);
    if (context_text != NULL) CFRelease(context_text);
    CFRelease(text);
    if (definition == NULL) return NULL;

    char* result = copy_utf8(definition);
    CFRelease(definition);
    return result;
}

char* pod_dictionary_lookup(const char* word) {
    return pod_dictionary_lookup_context(word, NULL, -1);
}

void pod_dictionary_free(char* text) {
    free(text);
}
